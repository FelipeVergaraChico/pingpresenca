import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Principal } from './authorization.js';
import { digest, hashPassword } from './password.js';
import { managed, adminOnly } from '../academic/access.js';
import { transaction } from '../db/pool.js';
import { AppError } from '../platform/errors.js';

const reasonSchema = z.string().trim().min(3).max(1000);
const tokenSchema = z.string().regex(/^[\w-]{43}$/);
const unavailable = () => new AppError(410, 'RECOVERY_UNAVAILABLE', 'Link inválido, expirado, substituído ou sem autorização atual. Solicite nova recuperação.');
async function account(c: pg.PoolClient, id: string) {
  return (await c.query(`SELECT a.id,a.active,a.password_hash IS NOT NULL AS accepted,
    ARRAY(SELECT role FROM account_roles WHERE account_id=a.id) AS roles FROM accounts a WHERE a.id=$1 FOR UPDATE`, [id])).rows[0];
}
function canRecover(issuer: { roles: string[]; active?: boolean }, roles: string[]) {
  if (issuer.active === false || roles.includes('OWNER')) return false;
  return roles.includes('ADMIN') ? issuer.roles.includes('OWNER')
    : issuer.roles.some(r => r === 'OWNER' || r === 'ADMIN') && roles.some(r => r === 'STUDENT' || r === 'PROFESSOR');
}
async function recoveryAudit(c: pg.PoolClient, actorId: string | null, origin: string, action: string, accountId: string, details: object) {
  await c.query(`INSERT INTO audit_events(id,actor_id,actor_kind,actor_role,action,target_id,details)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), actorId, origin === 'INFRASTRUCTURE' ? 'INFRASTRUCTURE' : 'USER', origin, action, accountId, details]);
}
export async function issueRecovery(c: pg.PoolClient, origin: string, targetId: string, reason: string, issuer: Principal | null) {
  reason = reasonSchema.parse(reason);
  const target = await account(c, targetId);
  if (!target?.active || !target.accepted) throw unavailable();
  if (issuer ? !canRecover(issuer, target.roles) : !target.roles.includes('OWNER'))
    throw new AppError(403, 'RECOVERY_FORBIDDEN', 'Recuperação não permitida para esta conta. Owner exige comando na infraestrutura.');
  const authority = !issuer ? 'INFRASTRUCTURE' : issuer.roles.includes('OWNER') ? 'OWNER' : 'ADMINISTRATIVE';
  await c.query('UPDATE password_recoveries SET revoked_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL', [targetId]);
  const token = randomBytes(32).toString('base64url'), id = randomUUID();
  const row = (await c.query(`INSERT INTO password_recoveries(id,account_id,token_hash,initiated_by,authority,reason,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '15 minutes') RETURNING expires_at`, [id, targetId, digest(token), issuer?.id ?? null, authority, reason])).rows[0];
  await recoveryAudit(c, issuer?.id ?? null, authority, 'RECOVERY_INITIATED', targetId, { recoveryId: id, reason, expiresAt: row.expires_at });
  return { url: `${origin}/#recovery=${token}`, expiresAt: row.expires_at };
}
export async function recoverOwner(pool: pg.Pool, origin: string, reason: string) {
  return transaction(pool, async c => {
    await c.query('SELECT pg_advisory_xact_lock(720261002)');
    const owner = (await c.query("SELECT account_id FROM account_roles WHERE role='OWNER'")).rows[0];
    if (!owner) throw new AppError(409, 'OWNER_MISSING', 'Nenhum owner existente. Este comando não cria contas.');
    return issueRecovery(c, origin, owner.account_id, reason, null);
  });
}
async function valid(c: pg.PoolClient, token: string) {
  const row = (await c.query(`SELECT * FROM password_recoveries WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`, [digest(token)])).rows[0];
  if (!row) throw unavailable();
  const target = await account(c, row.account_id);
  if (!target?.active || !target.accepted) throw unavailable();
  if (row.authority === 'INFRASTRUCTURE') {
    if (!target.roles.includes('OWNER')) throw unavailable();
  } else {
    const issuer = await account(c, row.initiated_by);
    if (!issuer || !canRecover(issuer, target.roles) || (row.authority === 'ADMINISTRATIVE' && target.roles.includes('ADMIN')))
      throw unavailable();
  }
  return row;
}
export function registerRecovery(app: FastifyInstance, pool: pg.Pool, config: Config, token: (r: FastifyRequest) => string | undefined) {
  app.post('/api/admin/accounts/:id/recovery', r => {
    const input = z.strictObject({ reason: reasonSchema }).parse(r.body);
    const id = z.uuid().parse((r.params as { id: string }).id);
    return managed(pool, token(r), (c,p) => { adminOnly(p); return issueRecovery(c, config.publicOrigin, id, input.reason, p); });
  });
  app.post('/api/recovery/inspect', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async r => {
    const input = z.strictObject({ token: tokenSchema }).parse(r.body);
    return transaction(pool, async c => {
      await c.query('SELECT pg_advisory_xact_lock(720261002)');
      const row = await valid(c, input.token);
      return { ...(await c.query('SELECT name,email FROM account_profiles WHERE account_id=$1', [row.account_id])).rows[0], expiresAt: row.expires_at };
    });
  });
  app.post('/api/recovery/complete', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async r => {
    const input = z.strictObject({ token: tokenSchema, password: z.string().min(12).max(128) }).parse(r.body);
    const encoded = await hashPassword(input.password);
    return transaction(pool, async c => {
      await c.query('SELECT pg_advisory_xact_lock(720261002)');
      const row = await valid(c, input.token);
      // Check the deadline again after acquiring account/authority locks.
      const consumed = await c.query('UPDATE password_recoveries SET consumed_at=clock_timestamp() WHERE id=$1 AND expires_at>clock_timestamp() RETURNING id', [row.id]);
      if (!consumed.rowCount) throw unavailable();
      await c.query('UPDATE accounts SET password_hash=$2,version=version+1 WHERE id=$1', [row.account_id, encoded]);
      await c.query('UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE account_id=$1 AND revoked_at IS NULL', [row.account_id]);
      await c.query('UPDATE password_recoveries SET revoked_at=clock_timestamp() WHERE account_id=$1 AND id<>$2 AND revoked_at IS NULL AND consumed_at IS NULL', [row.account_id, row.id]);
      await recoveryAudit(c, row.account_id, 'ACCOUNT', 'RECOVERY_COMPLETED', row.account_id, { recoveryId: row.id, initiatedBy: row.initiated_by, origin: row.authority, reason: row.reason, sessionsRevoked: true });
      return { updated: true };
    });
  });
}
