import type pg from 'pg';
import { transaction } from '../db/pool.js';
import { authenticate } from '../identity/service.js';
import type { Principal } from '../identity/authorization.js';
import { AppError } from '../platform/errors.js';

export const isAdmin = (p: Principal) => p.roles.includes('OWNER') || p.roles.includes('ADMIN');
export function adminOnly(p: Principal) {
  if (!isAdmin(p)) throw new AppError(403, 'FORBIDDEN', 'Operação exclusiva da administração.');
}
export function checkVersion(actual: number, supplied: number) {
  if (actual !== supplied)
    throw new AppError(
      409,
      'VERSION_CONFLICT',
      'O registro foi alterado. Atualize a tela, revise os dados e tente novamente.',
    );
}
export function notFound(): never {
  throw new AppError(404, 'NOT_FOUND', 'Registro não encontrado ou acesso não permitido.');
}

// Serializes low-volume E1 administrative changes with their authorization reads.
// Attendance traffic must use resource-scoped concurrency in E2/E3, not this lock.
export async function managed<T>(
  pool: pg.Pool,
  token: string | undefined,
  work: (c: pg.PoolClient, p: Principal) => Promise<T>,
) {
  return transaction(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(720261002)');
    const p = await authenticate(c, token);
    if (!p) throw new AppError(401, 'UNAUTHENTICATED', 'Entre na sua conta para continuar.');
    return work(c, p);
  });
}
export async function teachingOffering(
  c: pg.PoolClient,
  p: Principal,
  id: string,
  writing = false,
) {
  const {
    rows: [row],
  } = await c.query(
    `SELECT o.* FROM offerings o WHERE o.id=$1 AND
    ($2 OR ($3 AND EXISTS (SELECT 1 FROM offering_teachers t WHERE t.offering_id=o.id AND t.account_id=$4)))`,
    [id, isAdmin(p), p.roles.includes('PROFESSOR'), p.id],
  );
  if (!row) notFound();
  if (writing && !row.active)
    throw new AppError(
      409,
      'OFFERING_INACTIVE',
      'A turma está arquivada e não admite nova atividade.',
    );
  return row;
}
