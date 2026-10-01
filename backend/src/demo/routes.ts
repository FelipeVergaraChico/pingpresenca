import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { AppError } from '../platform/errors.js';
import { authenticate } from '../identity/service.js';
import { demoLogin, demoProfiles, reserveDemoWrite } from './service.js';

export function demoWriteAllowed(route: string) {
  return route === '/api/lessons' || route === '/api/lessons/:id' ||
    /^\/api\/attendance\/:id\/(open|close|reopen|cancel|location|authorize|confirm|result|decision)$/.test(route);
}

export function registerDemo(app: FastifyInstance, pool: pg.Pool,
  token: (request: FastifyRequest) => string | undefined,
  setSession: (reply: import('fastify').FastifyReply, token: string, expiresAt: Date) => void) {
  app.addHook('preHandler', async request => {
    const route = request.routeOptions.url ?? '';
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (/\/api\/(admin|invitations|recovery)(\/|$)/.test(route))
        throw new AppError(403, 'DEMO_RESTRICTED', 'Gestão de contas e recuperação não estão disponíveis na demonstração.');
      return;
    }
    if (route === '/api/demo/login' || route === '/api/auth/logout') return;
    if (!demoWriteAllowed(route))
      throw new AppError(403, 'DEMO_RESTRICTED', 'Esta operação não está disponível na demonstração pública.');
    if (!(await authenticate(pool, token(request))))
      throw new AppError(401, 'UNAUTHENTICATED', 'Escolha um perfil fictício para experimentar.');
    const body = request.body as Record<string, unknown> | undefined;
    if (body?.attendanceMode && body.attendanceMode !== 'PILOT')
      throw new AppError(400, 'DEMO_PILOT_ONLY', 'A demonstração permite apenas aulas em modo Piloto / teste.');
    await reserveDemoWrite(pool, route === '/api/lessons');
  });
  app.post('/api/demo/login', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { profile } = z.strictObject({ profile: z.enum(demoProfiles) }).parse(request.body);
      // Switching profiles revokes this browser's previous session via the normal logout route in UI.
      const session = await demoLogin(pool, profile);
      setSession(reply, session.token, session.expiresAt);
      return { authenticated: true };
    });
}
