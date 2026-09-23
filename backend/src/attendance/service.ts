import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../db/pool.js';
import { authenticate } from '../identity/service.js';
import type { Principal } from '../identity/authorization.js';
import { AppError } from '../platform/errors.js';
import { checkVersion, isAdmin, notFound } from '../academic/access.js';
import { policySnapshot } from '../academic/domain.js';
import {
  AUTHORIZATION_MS,
  challenge,
  evaluateGeo,
  frequency,
  hash,
  matches,
  reasons,
  type GeoInput,
  type Policy,
} from './domain.js';

type Client = pg.PoolClient;
type Lesson = {
  id: string;
  offering_id: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  attendance_mode: string;
  location_id: string;
  active: boolean;
  offering_name: string;
  discipline_name: string;
  cancelled_at: Date | null;
  version: number;
};
type Opening = {
  id: string;
  session_id: string;
  expires_at: Date;
  closed_at: Date | null;
  snapshot: Policy;
  challenge_seed: string;
};
type Context = { c: Client; p: Principal; l: Lesson };
function fail(code: string, message: string, status = 409): never {
  throw new AppError(status, code, message);
}
const now = async (c: Client): Promise<Date> =>
  (await c.query('SELECT clock_timestamp() AS now')).rows[0].now;
const publicLesson = (l: Lesson) => ({
  id: l.id,
  title: l.title,
  offeringId: l.offering_id,
  offering: l.offering_name,
  discipline: l.discipline_name,
  startsAt: l.starts_at,
  endsAt: l.ends_at,
  mode: l.attendance_mode,
  cancelled: !!l.cancelled_at,
});
async function event(
  c: Client,
  p: Principal | null,
  action: string,
  lessonId: string,
  details: Record<string, unknown>,
) {
  await c.query(
    `INSERT INTO audit_events(id,actor_id,actor_kind,actor_role,action,target_id,details)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      randomUUID(),
      p?.id ?? null,
      p ? 'USER' : 'SYSTEM',
      p
        ? action === 'ATTENDANCE_ATTEMPT' ? 'STUDENT' : isAdmin(p)
          ? 'ADMINISTRATIVE'
          : p.roles.includes('PROFESSOR')
            ? 'PROFESSOR'
            : 'STUDENT'
        : null,
      action,
      lessonId,
      details,
    ],
  );
}
async function isEligible(c: Client, l: Lesson, id: string) {
  return !!(
    await c.query(
      `SELECT 1 FROM enrollments WHERE offering_id=$1 AND account_id=$2
    AND enrolled_at <= $3 AND (ended_at IS NULL OR ended_at > $3)`,
      [l.offering_id, id, l.starts_at],
    )
  ).rowCount;
}
async function canManage(c: Client, p: Principal, l: Lesson) {
  return (
    isAdmin(p) ||
    (p.roles.includes('PROFESSOR') &&
      !!(
        await c.query('SELECT 1 FROM offering_teachers WHERE offering_id=$1 AND account_id=$2', [
          l.offering_id,
          p.id,
        ])
      ).rowCount)
  );
}
async function requireManager(ctx: Context, reason?: string, mutation = false) {
  if (!(await canManage(ctx.c, ctx.p, ctx.l))) notFound();
  if (mutation && isAdmin(ctx.p) && !reason?.trim())
    fail('REASON_REQUIRED', 'Intervenção administrativa exige justificativa.', 400);
}
async function current(c: Client, lessonId: string): Promise<Opening | undefined> {
  return (
    await c.query(
      `SELECT o.* FROM attendance_openings o JOIN attendance_sessions s ON s.id=o.session_id
    WHERE s.lesson_id=$1 ORDER BY o.opened_at DESC LIMIT 1`,
      [lessonId],
    )
  ).rows[0];
}
async function close(c: Client, l: Lesson, o: Opening, p: Principal | null, reason: string) {
  if (o.closed_at) return;
  const time = await now(c);
  await c.query('UPDATE attendance_openings SET closed_at=$2 WHERE id=$1', [o.id, time]);
  if (l.cancelled_at) { o.closed_at = time; return; }
  await c.query(
    'UPDATE attendance_sessions SET first_closed_at=COALESCE(first_closed_at,$2) WHERE id=$1',
    [o.session_id, time],
  );
  const inserted = await c.query(
    `INSERT INTO attendance_records(lesson_id,account_id,status,source,reason)
    SELECT $1,e.account_id,'ABSENT','AUTO_CLOSE','AUTO_CLOSE' FROM enrollments e
    WHERE e.offering_id=$2 AND e.enrolled_at <= $3 AND (e.ended_at IS NULL OR e.ended_at > $3)
    ON CONFLICT(lesson_id,account_id) DO NOTHING RETURNING account_id`,
    [l.id, l.offering_id, l.starts_at],
  );
  for (const row of inserted.rows)
    await event(c, null, 'ABSENCE_CONSOLIDATED', l.id, {
      accountId: row.account_id,
      before: null,
      after: { status: 'ABSENT', source: 'AUTO_CLOSE', version: 1 },
      openingId: o.id,
    });
  await event(c, p, p ? 'ATTENDANCE_CLOSED' : 'ATTENDANCE_AUTO_CLOSED', l.id, {
    openingId: o.id,
    reason,
    before: 'OPEN',
    after: 'CLOSED',
  });
  o.closed_at = time;
}

// Shared barrier against E1 administrative mutations + per-lesson row lock.
// Different lessons may process attendance concurrently. No external queue needed.
export async function inLesson<T>(
  pool: pg.Pool,
  token: string | undefined,
  id: string,
  work: (ctx: Context) => Promise<T>,
  exclusive = false,
  consolidateExpired = true,
): Promise<T> {
  const result = await transaction(pool, async (c) => {
    await c.query(
      exclusive
        ? 'SELECT pg_advisory_xact_lock(720261002)'
        : 'SELECT pg_advisory_xact_lock_shared(720261002)',
    );
    const l = (
      await c.query<Lesson>(
        `SELECT l.*,o.active,o.name AS offering_name,d.name AS discipline_name
      FROM lessons l JOIN offerings o ON o.id=l.offering_id JOIN disciplines d ON d.id=o.discipline_id
      WHERE l.id=$1 FOR UPDATE OF l`,
        [id],
      )
    ).rows[0];
    const p = await authenticate(c, token);
    if (!p) fail('UNAUTHENTICATED', 'Entre na sua conta para continuar.', 401);
    if (!l) notFound();
    if (!(await canManage(c, p, l)) && !(await isEligible(c, l, p.id))) notFound();
    const o = await current(c, l.id);
    if (consolidateExpired && o && !o.closed_at && (await now(c)) >= o.expires_at)
      await close(c, l, o, null, 'Prazo encerrado.');
    // Domain rejection may follow automatic close; keep the close committed, but
    // roll back the failed operation. SQL/audit faults roll back the whole transaction.
    await c.query('SAVEPOINT attendance_operation');
    try {
      return { value: await work({ c, p, l }) };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      await c.query('ROLLBACK TO SAVEPOINT attendance_operation');
      return { error };
    }
  });
  if ('error' in result) throw result.error;
  return result.value!;
}
async function live(c: Client, l: Lesson) {
  const o = await current(c, l.id),
    time = await now(c);
  if (
    l.cancelled_at || !o ||
    o.closed_at ||
    time >= o.expires_at ||
    time < l.starts_at ||
    time >= l.ends_at ||
    !l.active
  )
    fail('ATTENDANCE_CLOSED', 'A chamada está encerrada ou fora do horário da aula.');
  return { o, time };
}

export async function openAttendance(ctx: Context, minutes: number | undefined, reason: string, reopening?: { openingId: string }) {
  const { c, p, l } = ctx;
  await requireManager(ctx, reason, true);
  const previous = await current(c, l.id);
  if (reopening) {
    if (!previous || previous.id !== reopening.openingId || !previous.closed_at)
      fail('VERSION_CONFLICT', 'A abertura mudou. Atualize a tela antes de reabrir.');
    if (!reason.trim()) fail('REASON_REQUIRED', 'Reabrir exige justificativa.', 400);
  } else if (previous) fail('ALREADY_OPENED', 'Esta aula já teve chamada. Utilize a reabertura justificada.');
  const time = await now(c);
  if (l.cancelled_at || !l.active || time < l.starts_at || time >= l.ends_at)
    fail(
      'OUTSIDE_LESSON',
      'Abra a chamada somente durante o horário planejado de uma turma ativa.',
    );
  const defaults = (await c.query('SELECT attendance_minutes FROM installation')).rows[0];
  const expires = new Date(
    Math.min(
      time.getTime() + (minutes ?? defaults.attendance_minutes) * 60_000,
      l.ends_at.getTime(),
    ),
  );
  const location = (await c.query('SELECT * FROM locations WHERE id=$1', [l.location_id])).rows[0];
  const session = previous?.session_id ?? randomUUID(),
    opening = randomUUID();
  if (!previous) await c.query('INSERT INTO attendance_sessions(id,lesson_id) VALUES($1,$2)', [session, l.id]);
  await c.query(
    `INSERT INTO attendance_openings(id,session_id,opened_at,expires_at,snapshot,challenge_seed)
    VALUES($1,$2,$3,$4,$5,$6)`,
    [opening, session, time, expires, policySnapshot(location), randomBytes(32).toString('hex')],
  );
  await c.query(
    'UPDATE lessons SET context_locked_at=COALESCE(context_locked_at,$2),mode_locked_at=COALESCE(mode_locked_at,$2),version=version+1 WHERE id=$1',
    [l.id, time],
  );
  await event(c, p, previous ? 'ATTENDANCE_REOPENED' : 'ATTENDANCE_OPENED', l.id, {
    openingId: opening,
    reason,
    before: previous ? 'CLOSED' : 'NOT_OPENED',
    after: 'OPEN',
    expiresAt: expires,
  });
  return { openingId: opening, expiresAt: expires };
}
export async function cancelLesson(ctx: Context, version: number, reason: string) {
  const { c, p, l } = ctx;
  await requireManager(ctx, reason, true);
  checkVersion(l.version, version);
  if (l.cancelled_at) fail('LESSON_CANCELLED', 'A aula já está cancelada.');
  const time = await now(c);
  await c.query('UPDATE lessons SET cancelled_at=$2,cancellation_reason=$3,version=version+1 WHERE id=$1', [l.id, time, reason]);
  l.cancelled_at = time;
  const o = await current(c, l.id);
  if (o) await close(c, l, o, p, reason);
  await event(c, p, 'LESSON_CANCELLED', l.id, { reason, before: { cancelled: false, version }, after: { cancelled: true, version: version + 1 }, openingId: o?.id ?? null });
  return { cancelled: true };
}
export async function changeAttendanceLocation(ctx: Context, version: number, locationId: string, reason: string) {
  const { c, p, l } = ctx;
  await requireManager(ctx, reason, true);
  checkVersion(l.version, version);
  const o = await current(c, l.id);
  if (l.cancelled_at || (o && !o.closed_at)) fail('LOCATION_LOCKED', 'Encerre a chamada antes de mudar o local; aulas canceladas não podem ser replanejadas.');
  if (!(await c.query('SELECT 1 FROM locations WHERE id=$1', [locationId])).rowCount) notFound();
  await c.query('UPDATE lessons SET location_id=$2,version=version+1 WHERE id=$1', [l.id, locationId]);
  await event(c, p, 'LESSON_LOCATION_CHANGED', l.id, { reason, before: { locationId: l.location_id, version }, after: { locationId, version: version + 1 } });
  return { updated: true };
}
export async function closeAttendance(ctx: Context, reason: string, openingId: string) {
  await requireManager(ctx, reason, true);
  const o = await current(ctx.c, ctx.l.id);
  if (!o) fail('NOT_OPENED', 'Esta aula ainda não teve chamada.');
  if (o.id !== openingId) fail('VERSION_CONFLICT', 'A chamada foi reaberta. Revise a abertura atual antes de fechar.');
  await close(ctx.c, ctx.l, o, ctx.p, reason);
  return { closed: true };
}
export async function projection(ctx: Context, origin: string) {
  await requireManager(ctx);
  const { c, l } = ctx,
    o = await current(c, l.id),
    time = await now(c);
  const base = {
    lesson: publicLesson(l),
    serverNow: time,
    open: !l.cancelled_at && !!o && !o.closed_at && time < o.expires_at,
  };
  if (!base.open || !o) return base;
  const code = challenge(o.challenge_seed, time.getTime());
  return {
    ...base,
    code: code.code,
    rotatesAt: new Date(Math.min(code.rotatesAt, o.expires_at.getTime())),
    expiresAt: o.expires_at,
    qrUrl: `${origin}/#attendance=${l.id}&challenge=${code.qr}`,
  };
}
export async function authorize(ctx: Context, input: { code?: string; qr?: string }) {
  const { c, p, l } = ctx;
  if (!p.roles.includes('STUDENT') || !(await isEligible(c, l, p.id))) notFound();
  const { o, time } = await live(c, l);
  const window = Math.floor(time.getTime() / 60_000);
  const limit = (
    await c.query(
      `INSERT INTO attendance_code_limits(opening_id,account_id,bucket,count) VALUES($1,$2,$3,1)
    ON CONFLICT(opening_id,account_id) DO UPDATE SET bucket=$3,
    count=CASE WHEN attendance_code_limits.bucket=$3 THEN attendance_code_limits.count+1 ELSE 1 END RETURNING count`,
      [o.id, p.id, window],
    )
  ).rows[0].count;
  // Return an error value so failed guesses consume the persistent budget.
  if (limit > 10)
    return {
      error: new AppError(
        429,
        'CODE_RATE_LIMIT',
        'Muitas tentativas de código. Aguarde um minuto.',
      ),
    };
  const expected = challenge(o.challenge_seed, time.getTime());
  if (
    !(input.code ? matches(input.code, expected.code) : input.qr && matches(input.qr, expected.qr))
  )
    return {
      error: new AppError(
        400,
        'INVALID_CODE',
        'Código inválido ou expirado. Leia o QR novamente ou informe o código atual.',
      ),
    };
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(
    Math.min(time.getTime() + AUTHORIZATION_MS, o.expires_at.getTime(), l.ends_at.getTime()),
  );
  await c.query(
    'INSERT INTO attendance_authorizations(id,token_hash,account_id,opening_id,expires_at) VALUES($1,$2,$3,$4,$5)',
    [randomUUID(), hash(token), p.id, o.id, expiresAt],
  );
  return {
    token,
    expiresAt,
    serverNow: time,
    lesson: publicLesson(l),
    geoRequired: o.snapshot.geoRequired,
  };
}
export async function confirm(ctx: Context, token: string, geo: GeoInput) {
  const { c, p, l } = ctx;
  if (!p.roles.includes('STUDENT') || !(await isEligible(c, l, p.id))) notFound();
  const auth = (
    await c.query(
      `SELECT a.* FROM attendance_authorizations a JOIN attendance_openings o ON o.id=a.opening_id
    JOIN attendance_sessions s ON s.id=o.session_id WHERE a.token_hash=$1 AND a.account_id=$2 AND s.lesson_id=$3`,
      [hash(token), p.id, l.id],
    )
  ).rows[0];
  if (!auth) fail('INVALID_AUTHORIZATION', 'Autorização inválida. Inicie uma nova tentativa.', 400);
  const previous = (
    await c.query('SELECT id,outcome,reason FROM attendance_attempts WHERE authorization_id=$1', [
      auth.id,
    ])
  ).rows[0];
  if (previous) return { ...previous, message: reasons[previous.reason], replay: true };
  const { o } = await live(c, l);
  if (o.id !== auth.opening_id)
    fail('AUTHORIZATION_EXPIRED', 'A autorização expirou. Use o código atual.');
  const before = (
    await c.query('SELECT * FROM attendance_records WHERE lesson_id=$1 AND account_id=$2', [
      l.id,
      p.id,
    ])
  ).rows[0];
  const result = before?.manual
    ? {
        outcome: 'REJECTED',
        reason: 'MANUAL_PROTECTED',
        distance: null,
        accuracy: null,
      }
    : evaluateGeo(o.snapshot, geo);
  // The database clock in this INSERT is the acceptance linearization point.
  // A request waiting for locks never reserves an earlier acceptance time.
  const attempt = (
    await c.query(
      `WITH decision AS MATERIALIZED (SELECT clock_timestamp() AS at)
    INSERT INTO attendance_attempts(id,authorization_id,outcome,reason,distance,accuracy,recorded_at)
    SELECT $1,$2,$3,$4,$5,$6,at FROM decision WHERE at < $7 AND at < $8 AND at < $9
    RETURNING id,outcome,reason,recorded_at`,
      [
        randomUUID(),
        auth.id,
        result.outcome,
        result.reason,
        result.distance,
        result.accuracy,
        auth.expires_at,
        o.expires_at,
        l.ends_at,
      ],
    )
  ).rows[0];
  if (!attempt)
    fail(
      'AUTHORIZATION_EXPIRED',
      'A autorização ou chamada expirou. Use o código atual se a chamada continuar aberta.',
    );
  if (
    result.outcome === 'ACCEPTED' ||
    (result.outcome === 'PENDING' && before?.status !== 'PRESENT')
  ) {
    const status = result.outcome === 'ACCEPTED' ? 'PRESENT' : 'PENDING';
    await c.query(
      `INSERT INTO attendance_records(lesson_id,account_id,status,source,reason) VALUES($1,$2,$3,'AUTOMATIC',$4)
      ON CONFLICT(lesson_id,account_id) DO UPDATE SET status=$3,source='AUTOMATIC',reason=$4,
      version=attendance_records.version+1,updated_at=$5`,
      [l.id, p.id, status, result.reason, attempt.recorded_at],
    );
    if (status === 'PRESENT') await resolvePending(c, l.id, p.id, 'SUPERSEDED');
  } else if (before?.status === 'PENDING') {
    // A reviewer must acknowledge new context even when a rejection preserves the pending state.
    await c.query(
      'UPDATE attendance_records SET version=version+1,updated_at=$3 WHERE lesson_id=$1 AND account_id=$2',
      [l.id, p.id, attempt.recorded_at],
    );
  } else if (before?.status === 'PRESENT' && result.outcome === 'PENDING') {
    await resolvePending(c, l.id, p.id, 'SUPERSEDED');
  }
  await event(c, p, 'ATTENDANCE_ATTEMPT', l.id, {
    accountId: p.id,
    attemptId: attempt.id,
    openingId: o.id,
    outcome: result.outcome,
    reason: result.reason,
    before: before ? { status: before.status, version: before.version } : null,
    after:
      (
        await c.query(
          'SELECT status,version FROM attendance_records WHERE lesson_id=$1 AND account_id=$2',
          [l.id, p.id],
        )
      ).rows[0] ?? null,
  });
  return {
    id: attempt.id,
    outcome: result.outcome,
    reason: result.reason,
    message: reasons[result.reason],
    replay: false,
  };
}
export async function attemptResult(ctx: Context, token: string) {
  const { c, p, l } = ctx;
  const row = (
    await c.query(
      `SELECT t.id,t.outcome,t.reason FROM attendance_authorizations a
    JOIN attendance_openings o ON o.id=a.opening_id JOIN attendance_sessions s ON s.id=o.session_id
    LEFT JOIN attendance_attempts t ON t.authorization_id=a.id
    WHERE a.token_hash=$1 AND a.account_id=$2 AND s.lesson_id=$3`,
      [hash(token), p.id, l.id],
    )
  ).rows[0];
  if (!row) notFound();
  return row.id
    ? { ...row, message: reasons[row.reason] }
    : {
        outcome: null,
        message: 'Nenhuma tentativa registrada. Inicie novamente com o código atual.',
      };
}
async function resolvePending(c: Client, lessonId: string, accountId: string, resolution: string) {
  await c.query(
    `UPDATE attendance_attempts t SET resolution=$3,resolved_at=clock_timestamp()
    FROM attendance_authorizations a,attendance_openings o,attendance_sessions s
    WHERE t.authorization_id=a.id AND a.opening_id=o.id AND o.session_id=s.id AND s.lesson_id=$1
    AND a.account_id=$2 AND t.outcome='PENDING' AND t.resolution IS NULL`,
    [lessonId, accountId, resolution],
  );
}
export async function manualDecision(
  ctx: Context,
  input: {
    accountId: string;
    version: number;
    status: 'PRESENT' | 'ABSENT';
    kind: 'MANUAL' | 'PENDING_DECISION' | 'CORRECTION';
    reason: string;
  },
) {
  const { c, p, l } = ctx;
  await requireManager(ctx, input.reason, true);
  if (!(await current(c, l.id)))
    fail(
      'NOT_OPENED',
      'Abra a chamada antes de lançar presenças. Consolidação inteiramente manual pertence à E5.',
    );
  if (!(await isEligible(c, l, input.accountId))) notFound();
  const before = (
    await c.query('SELECT * FROM attendance_records WHERE lesson_id=$1 AND account_id=$2', [
      l.id,
      input.accountId,
    ])
  ).rows[0];
  checkVersion(before?.version ?? 0, input.version);
  if (input.kind === 'PENDING_DECISION' && before?.status !== 'PENDING')
    fail('NO_PENDING', 'Não há pendência ativa para decidir. Atualize os dados.');
  if (
    input.kind === 'MANUAL' &&
    (input.status !== 'PRESENT' || (before && before.source !== 'AUTO_CLOSE'))
  )
    fail(
      'USE_CORRECTION',
      'Use a decisão de pendência ou correção para alterar um registro já existente.',
    );
  if (input.kind === 'CORRECTION' && !before)
    fail('NO_RECORD', 'Use presença manual para um aluno sem registro.');
  await c.query(
    `INSERT INTO attendance_records(lesson_id,account_id,status,source,manual,reason) VALUES($1,$2,$3,$4,true,$5)
    ON CONFLICT(lesson_id,account_id) DO UPDATE SET status=$3,source=$4,manual=true,reason=$5,
    version=attendance_records.version+1,updated_at=clock_timestamp()`,
    [l.id, input.accountId, input.status, input.kind, input.reason],
  );
  await resolvePending(
    c,
    l.id,
    input.accountId,
    input.status === 'PRESENT' ? 'APPROVED' : 'REJECTED',
  );
  await event(
    c,
    p,
    input.kind === 'MANUAL'
      ? 'MANUAL_PRESENCE'
      : input.kind === 'PENDING_DECISION'
        ? 'PENDING_DECISION'
        : 'ATTENDANCE_CORRECTION',
    l.id,
    {
      accountId: input.accountId,
      reason: input.reason,
      before: before
        ? {
            status: before.status,
            source: before.source,
            version: before.version,
          }
        : null,
      after: {
        status: input.status,
        source: input.kind,
        version: (before?.version ?? 0) + 1,
      },
    },
  );
  return { updated: true };
}
export async function attendanceView(ctx: Context) {
  const { c, p, l } = ctx,
    manages = await canManage(c, p, l),
    o = await current(c, l.id);
  const time = await now(c),
    settings = (await c.query('SELECT attendance_minutes FROM installation')).rows[0];
  const records = (
    await c.query(
      `SELECT e.account_id,p.name,r.status,r.source,r.reason,COALESCE(r.version,0) AS version,r.manual
    FROM enrollments e JOIN account_profiles p ON p.account_id=e.account_id
    LEFT JOIN attendance_records r ON r.account_id=e.account_id AND r.lesson_id=$1
    WHERE e.offering_id=$2 AND e.enrolled_at <= $3 AND (e.ended_at IS NULL OR e.ended_at > $3)
    AND ($4 OR e.account_id=$5) ORDER BY p.name,e.account_id`,
      [l.id, l.offering_id, l.starts_at, manages, p.id],
    )
  ).rows;
  const attempts = (
    await c.query(
      `SELECT t.id,a.account_id,a.opening_id,t.outcome,t.reason,t.recorded_at,t.resolution,
    CASE WHEN $3 THEN t.distance END AS distance,CASE WHEN $3 THEN t.accuracy END AS accuracy
    FROM attendance_attempts t JOIN attendance_authorizations a ON a.id=t.authorization_id
    JOIN attendance_openings o ON o.id=a.opening_id JOIN attendance_sessions s ON s.id=o.session_id
    WHERE s.lesson_id=$1 AND ($3 OR a.account_id=$2) ORDER BY t.recorded_at,t.id`,
      [l.id, p.id, manages],
    )
  ).rows;
  return {
    lesson: publicLesson(l),
    manages,
    administrative: isAdmin(p),
    lessonVersion: l.version,
    openingId: o?.id ?? null,
    serverNow: time,
    state: l.cancelled_at ? 'CANCELLED' : !o ? 'NOT_OPENED' : o.closed_at ? 'CLOSED' : 'OPEN',
    expiresAt: o?.expires_at ?? null,
    defaultMinutes: settings.attendance_minutes,
    records: records.map((r) => ({
      ...r,
      reason: !manages && r.manual ? 'Registro definido manualmente.' : r.reason,
    })),
    attempts: attempts.map((t) => ({ ...t, message: reasons[t.reason] })),
    audit: manages
      ? (
          await c.query(
            'SELECT id,actor_id,actor_kind,actor_role,action,occurred_at,details FROM audit_events WHERE target_id=$1 ORDER BY occurred_at,id',
            [l.id],
          )
        ).rows
      : [],
  };
}
export async function studentHistory(pool: pg.Pool, token: string | undefined, offeringId: string) {
  return transaction(pool, async (c) => {
    const p = await authenticate(c, token);
    if (!p) fail('UNAUTHENTICATED', 'Entre na sua conta.', 401);
    if (!p.roles.includes('STUDENT')) notFound();
    if (
      !(
        await c.query('SELECT 1 FROM enrollments WHERE offering_id=$1 AND account_id=$2', [
          offeringId,
          p.id,
        ])
      ).rowCount
    )
      notFound();
    const rows = (
      await c.query(
        `SELECT l.id,l.title,l.starts_at,l.ends_at,l.attendance_mode,r.status,r.source,
      CASE WHEN r.manual THEN 'Registro definido manualmente.' ELSE r.reason END AS reason,
      (s.first_closed_at IS NOT NULL AND l.cancelled_at IS NULL) AS included,
      l.cancelled_at IS NOT NULL AS cancelled,
      EXISTS(SELECT 1 FROM attendance_openings o WHERE o.session_id=s.id AND o.closed_at IS NULL AND o.expires_at>clock_timestamp()) AS reopened
      FROM lessons l
      LEFT JOIN attendance_sessions s ON s.lesson_id=l.id LEFT JOIN attendance_records r ON r.lesson_id=l.id AND r.account_id=$2
      WHERE l.offering_id=$1 AND EXISTS(SELECT 1 FROM enrollments e WHERE e.offering_id=l.offering_id AND e.account_id=$2
      AND e.enrolled_at<=l.starts_at AND (e.ended_at IS NULL OR e.ended_at>l.starts_at)) ORDER BY l.starts_at,l.id`,
        [offeringId, p.id],
      )
    ).rows;
    return {
      lessons: rows.map((r) => ({
        ...r,
        reason: reasons[r.reason] ?? r.reason,
      })),
      frequency: frequency(rows),
    };
  });
}

export async function expireDue(pool: pg.Pool) {
  const ids = (
    await pool.query(`SELECT s.lesson_id FROM attendance_openings o JOIN attendance_sessions s ON s.id=o.session_id
    WHERE o.closed_at IS NULL AND o.expires_at<=clock_timestamp() ORDER BY o.expires_at LIMIT 100`)
  ).rows;
  for (const { lesson_id } of ids)
    await transaction(pool, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock_shared(720261002)');
      const l = (await c.query('SELECT * FROM lessons WHERE id=$1 FOR UPDATE', [lesson_id]))
        .rows[0];
      const o = await current(c, lesson_id);
      if (o && !o.closed_at && (await now(c)) >= o.expires_at)
        await close(c, l, o, null, 'Prazo encerrado.');
    });
}
