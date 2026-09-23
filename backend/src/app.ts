import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type pg from 'pg';
import type { Config } from './config.js';
import { AppError } from './platform/errors.js';
import { validationErrors } from './platform/validation.js';
import { installationStatus } from './installation.js';
import { bootstrap, login, authenticate, logout } from './identity/service.js';
import { requirePermission } from './identity/authorization.js';
import { registerIdentityManagement } from './identity/management.js';
import { registerAcademic } from './academic/routes.js';
import { registerAttendance } from './attendance/routes.js';
import { registerRecovery } from './identity/recovery.js';
import { assertSchemaReady } from './db/readiness.js';

const bootstrapSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
  secret: z.string().min(1).max(512),
});
const loginSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

export async function buildApp(config: Config, pool: pg.Pool, options: { logger?: FastifyServerOptions['logger'] } = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 8192,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(helmet);
  await app.register(rateLimit, { global: false });
  registerRecovery(app, pool, config, r => r.cookies[config.cookieSecure ? '__Host-ping_session' : 'ping_session']);
  const cookieName = config.cookieSecure ? '__Host-ping_session' : 'ping_session';
  const cookieOptions = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict' as const,
    path: '/',
  };

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    // Same-origin JSON API: protects bootstrap, login and authenticated mutations.
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin !== config.publicOrigin
    ) {
      throw new AppError(403, 'INVALID_ORIGIN', 'Origem da solicitação não permitida.');
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError)
      return reply
        .code(error.status)
        .send({ code: error.code, message: error.message, fieldErrors: error.fieldErrors });
    if (error instanceof z.ZodError) {
      const fieldErrors = validationErrors(error.issues);
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: fieldErrors.length
          ? 'Corrija os campos indicados e tente novamente.'
          : 'A solicitação contém dados inválidos ou não permitidos. Atualize a página e tente novamente.',
        fields: fieldErrors.map((i) => i.field),
        fieldErrors,
      });
    }
    const dbCode = typeof error === 'object' && error && 'code' in error ? error.code : null;
    if (dbCode === '23505') {
      const constraint =
        typeof error === 'object' && error && 'constraint' in error ? error.constraint : null;
      const fieldErrors =
        constraint === 'account_profiles_email_key'
          ? [
              {
                field: 'email',
                message:
                  'E-mail: este endereço já está cadastrado. Use outro ou selecione a conta existente.',
              },
            ]
          : constraint === 'account_profiles_institutional_id_key'
            ? [
                {
                  field: 'institutionalId',
                  message: 'Identificador institucional: este identificador já está cadastrado.',
                },
              ]
            : [];
      return reply
        .code(409)
        .send({
          code: 'DUPLICATE',
          message: fieldErrors.length
            ? 'Já existe um cadastro com o dado indicado.'
            : 'E-mail, identificador ou vínculo já cadastrado.',
          fieldErrors,
        });
    }
    if (dbCode === '23P01')
      return reply.code(409).send({
        code: 'ENROLLMENT_OVERLAP',
        message: 'Já existe matrícula nesse intervalo. Os períodos não podem se sobrepor.',
      });
    if (dbCode === '23503')
      return reply.code(400).send({
        code: 'INVALID_REFERENCE',
        message: 'O registro selecionado não existe ou ainda possui vínculos.',
      });
    const status =
      typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (status >= 400 && status < 500)
      return reply.code(status).send({
        code: 'REQUEST_REJECTED',
        message:
          status === 429
            ? 'Muitas tentativas. Aguarde um minuto e tente novamente.'
            : 'Solicitação inválida.',
      });
    // Error objects and payloads can contain personal data or DB credentials.
    request.log.error({ requestId: request.id }, 'Falha interna ao processar solicitação');
    return reply
      .code(500)
      .send({ code: 'INTERNAL_ERROR', message: 'Não foi possível concluir. Tente novamente.' });
  });

  app.get('/api/health', async () => {
    await assertSchemaReady(pool);
    return { status: 'ok', version: '0.4.0-e3' };
  });
  app.get('/api/installation', async () => ({
    ...(await installationStatus(pool)),
    bootstrapAvailable: Boolean(config.bootstrapSecret),
  }));
  app.post(
    '/api/bootstrap',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = bootstrapSchema.parse(request.body);
      const status = await installationStatus(pool);
      if (status.initialized)
        throw new AppError(
          409,
          'BOOTSTRAP_COMPLETED',
          'A configuração inicial já foi concluída. Entre na sua conta.',
        );
      const owner = await bootstrap(pool, config, input);
      return reply.code(201).send(owner);
    },
  );
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const token = await login(pool, config, input.email, input.password);
      reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: config.sessionTtlSeconds });
      return { authenticated: true };
    },
  );
  app.get('/api/auth/me', async (request) => {
    const principal = await authenticate(pool, request.cookies[cookieName]);
    if (!principal)
      throw new AppError(401, 'UNAUTHENTICATED', 'Entre na sua conta para continuar.');
    return principal;
  });
  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[cookieName];
    const principal = await authenticate(pool, token);
    if (principal && token) await logout(pool, token, principal);
    reply.clearCookie(cookieName, cookieOptions);
    return reply.code(204).send();
  });
  app.get('/api/admin/installation', async (request) => {
    requirePermission(await authenticate(pool, request.cookies[cookieName]), 'installation:read');
    const migrations = await pool.query(
      'SELECT name, applied_at FROM schema_migrations ORDER BY name',
    );
    return {
      ...(await installationStatus(pool)),
      version: '0.4.0-e3',
      migrations: migrations.rows,
    };
  });
  const sessionToken = (r: import('fastify').FastifyRequest) => r.cookies[cookieName];
  registerIdentityManagement(app, pool, config, sessionToken);
  registerAcademic(app, pool, sessionToken);
  registerAttendance(app, pool, config, sessionToken);
  return app;
}
