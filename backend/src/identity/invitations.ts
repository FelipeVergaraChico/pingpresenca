import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Principal } from './authorization.js';
import { digest } from './password.js';
import { audit } from '../audit.js';

// Caller authorizes and locks the target in its administrative transaction.
export async function issueManualInvitation(c: pg.PoolClient, actor: Principal, accountId: string, publicOrigin: string) {
  return issueInvitation(c, actor, accountId, publicOrigin, 'MANUAL');
}

export async function issueInvitation(c: pg.PoolClient, actor: Principal, accountId: string, publicOrigin: string, channel: 'MANUAL' | 'EMAIL', email: string | null = null) {
  await c.query('UPDATE invitations SET revoked_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL', [accountId]);
  const secret = randomBytes(32).toString('base64url');
  const invitationId = randomUUID();
  const { rows: [invitation] } = await c.query(
    `INSERT INTO invitations(id,account_id,token_hash,channel,created_by,expires_at,delivered_email)
     VALUES ($1,$2,$3,$5,$4,clock_timestamp()+interval '48 hours',$6) RETURNING expires_at`,
    [invitationId, accountId, digest(secret), actor.id, channel, email],
  );
  await audit(c, { actorId: actor.id, actorRole: actor.roles.includes('OWNER') ? 'OWNER' : 'ADMIN',
    action: 'INVITATION_ISSUED', targetId: accountId, details: { invitationId, channel, expiresAt: invitation.expires_at } });
  return { invitationId, url: `${publicOrigin}/#invite=${secret}`, expiresAt: invitation.expires_at, channel };
}
