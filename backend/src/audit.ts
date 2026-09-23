import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export async function audit(client: pg.PoolClient, event: {
  actorId: string; actorRole: string; action: string; targetId: string;
  details?: Record<string, unknown>;
}) {
  await client.query(`INSERT INTO audit_events(id, actor_id, actor_kind, actor_role, action, target_id, details)
    VALUES ($1, $2, 'USER', $3, $4, $5, $6)`,
  [randomUUID(), event.actorId, event.actorRole, event.action, event.targetId, event.details ?? {}]);
}
