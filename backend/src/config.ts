import { z } from 'zod';
import { isTimeZone } from './platform/time.js';

const integer = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const environment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: integer(3000, 1, 65535),
  PUBLIC_ORIGIN: z.url(),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  INSTALLATION_NAME: z.string().trim().min(1).max(160),
  INSTALLATION_TIME_ZONE: z.string().refine(isTimeZone, 'Fuso IANA inválido'),
  BOOTSTRAP_SECRET: z.string().max(512).optional(),
  SESSION_TTL_SECONDS: integer(28800, 60, 86400),
  DATABASE_URL: z.url().optional(),
  POSTGRES_HOST: z.string().default('127.0.0.1'),
  POSTGRES_PORT: integer(54329, 1, 65535),
  POSTGRES_DB: z.string().min(1).default('pingpresenca'),
  POSTGRES_USER: z.string().min(1).default('pingpresenca'),
  POSTGRES_PASSWORD: z.string().optional(),
});

export function parseConfig(env: NodeJS.ProcessEnv) {
  const result = environment.safeParse(env);
  if (!result.success) {
    // Never interpolate environment values (credentials may be inside URLs).
    throw new Error(`Configuração inválida: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  }
  const e = result.data;
  const origin = new URL(e.PUBLIC_ORIGIN);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== e.PUBLIC_ORIGIN || origin.username || origin.password) {
    throw new Error('PUBLIC_ORIGIN deve ser uma origem HTTP(S), sem caminho ou credenciais');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if ((!loopback && origin.protocol !== 'https:') || (origin.protocol === 'https:' && e.COOKIE_SECURE !== 'true') || (!loopback && e.COOKIE_SECURE !== 'true')) {
    throw new Error('HTTPS e cookie seguro são obrigatórios fora de loopback');
  }
  const bootstrapSecret = e.BOOTSTRAP_SECRET || undefined;
  if (bootstrapSecret && (bootstrapSecret.length < 32 || bootstrapSecret.startsWith('SUBSTITUA_'))) {
    throw new Error('BOOTSTRAP_SECRET deve conter um segredo aleatório com pelo menos 32 caracteres');
  }
  if (e.DATABASE_URL && !['postgres:', 'postgresql:'].includes(new URL(e.DATABASE_URL).protocol)) {
    throw new Error('DATABASE_URL deve usar PostgreSQL');
  }
  if (!e.DATABASE_URL && (!e.POSTGRES_PASSWORD || e.POSTGRES_PASSWORD.startsWith('SUBSTITUA_'))) {
    throw new Error('Configure POSTGRES_PASSWORD ou DATABASE_URL');
  }
  return {
    mode: e.NODE_ENV, host: e.API_HOST, port: e.API_PORT,
    publicOrigin: origin.origin, cookieSecure: e.COOKIE_SECURE === 'true',
    installationName: e.INSTALLATION_NAME, timeZone: e.INSTALLATION_TIME_ZONE,
    bootstrapSecret, sessionTtlSeconds: e.SESSION_TTL_SECONDS,
    database: e.DATABASE_URL ? { connectionString: e.DATABASE_URL } : {
      host: e.POSTGRES_HOST, port: e.POSTGRES_PORT, database: e.POSTGRES_DB,
      user: e.POSTGRES_USER, password: e.POSTGRES_PASSWORD,
    },
  };
}
export type Config = ReturnType<typeof parseConfig>;
