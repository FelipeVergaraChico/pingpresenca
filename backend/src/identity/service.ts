import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Config } from '../config.js';
import { transaction } from '../db/pool.js';
import { AppError } from '../platform/errors.js';
import { audit } from '../audit.js';
import { digest, hashPassword, sameSecret, verifyPassword } from './password.js';
import type { Principal } from './authorization.js';

export interface BootstrapInput {
  name: string;
  email: string;
  password: string;
  secret: string;
}

export async function bootstrap(pool: pg.Pool, config: Config, input: BootstrapInput) {
  if (!config.bootstrapSecret || !sameSecret(input.secret, config.bootstrapSecret)) {
    throw new AppError(
      403,
      'BOOTSTRAP_DENIED',
      'Segredo de configuração inválido ou indisponível.',
    );
  }
  const hash = await hashPassword(input.password);
  return transaction(pool, async (client) => {
    const {
      rows: [installation],
    } = await client.query(
      'SELECT bootstrap_completed_at FROM installation WHERE singleton FOR UPDATE',
    );
    const owner = await client.query("SELECT 1 FROM account_roles WHERE role = 'OWNER'");
    if (!installation || installation.bootstrap_completed_at || owner.rowCount) {
      throw new AppError(
        409,
        'BOOTSTRAP_COMPLETED',
        'A configuração inicial já foi concluída. Entre na sua conta.',
      );
    }
    const id = randomUUID();
    await client.query('INSERT INTO accounts(id, password_hash) VALUES ($1, $2)', [id, hash]);
    await client.query(
      'INSERT INTO account_profiles(account_id, name, email) VALUES ($1, $2, $3)',
      [id, input.name, input.email.toLowerCase()],
    );
    await client.query("INSERT INTO account_roles(account_id, role) VALUES ($1, 'OWNER')", [id]);
    await client.query(
      'UPDATE installation SET bootstrap_completed_at = clock_timestamp() WHERE singleton',
    );
    await audit(client, {
      actorId: id,
      actorRole: 'OWNER',
      action: 'OWNER_BOOTSTRAPPED',
      targetId: id,
      details: { before: null, after: { roles: ['OWNER'] } },
    });
    return { id };
  });
}

let dummyHash: Promise<string> | undefined;
export async function login(pool: pg.Pool, config: Config, email: string, password: string) {
  const {
    rows: [row],
  } = await pool.query(
    `SELECT a.id, a.password_hash, a.active FROM accounts a
    JOIN account_profiles p ON p.account_id = a.id WHERE p.email = $1`,
    [email.toLowerCase()],
  );
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  const valid = await verifyPassword(password, row?.password_hash ?? (await dummyHash));
  if (!row || !row.active || !valid)
    throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
  return transaction(pool, async (client) => {
    const {
      rows: [current],
    } = await client.query('SELECT active, password_hash FROM accounts WHERE id = $1 FOR UPDATE', [
      row.id,
    ]);
    if (!current?.active || current.password_hash !== row.password_hash)
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
    const token = randomBytes(32).toString('base64url');
    await client.query(
      `INSERT INTO auth_sessions(token_hash, account_id, expires_at)
      VALUES ($1, $2, clock_timestamp() + $3 * interval '1 second')`,
      [digest(token), row.id, config.sessionTtlSeconds],
    );
    await audit(client, {
      actorId: row.id,
      actorRole: 'ACCOUNT',
      action: 'SESSION_CREATED',
      targetId: row.id,
    });
    return token;
  });
}

export async function authenticate(
  pool: pg.Pool | pg.PoolClient,
  token?: string,
): Promise<Principal | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const {
    rows: [row],
  } = await pool.query(
    `SELECT a.id, p.name, p.email,
    ARRAY(SELECT role FROM account_roles WHERE account_id = a.id ORDER BY role) AS roles
    FROM auth_sessions s JOIN accounts a ON a.id = s.account_id
    JOIN account_profiles p ON p.account_id = a.id
    WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp() AND a.active`,
    [digest(token)],
  );
  return row ? { id: row.id, name: row.name, email: row.email, roles: row.roles } : null;
}

export async function logout(pool: pg.Pool, token: string, principal: Principal) {
  await transaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE auth_sessions SET revoked_at = clock_timestamp()
      WHERE token_hash = $1 AND revoked_at IS NULL RETURNING account_id`,
      [digest(token)],
    );
    if (result.rowCount)
      await audit(client, {
        actorId: principal.id,
        actorRole: 'ACCOUNT',
        action: 'SESSION_REVOKED',
        targetId: principal.id,
      });
  });
}
