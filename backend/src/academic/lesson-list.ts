import type pg from 'pg';
import { z } from 'zod';
import { AppError } from '../platform/errors.js';

const positive = (max: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(max));
// ISO permits year zero, but PostgreSQL's civil dates do not.
const date = z.iso.date().refine((value) => !value.startsWith('0000-'));
export const lessonListQuery = z.strictObject({
  page: positive(1_000_000).default(1),
  pageSize: positive(50).default(10),
  view: z.enum(['list', 'calendar']).default('list'),
  month: z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/).optional(),
  scope: z.enum(['all', 'upcoming', 'past']).default('all'),
  mode: z.enum(['PILOT', 'OFFICIAL']).optional(),
  status: z.enum(['NOT_OPENED', 'OPEN', 'CLOSED', 'CANCELLED', 'PRESENT', 'ABSENT', 'PENDING', 'NONE']).optional(),
  from: date.optional(),
  to: date.optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, {
  path: ['to'], message: 'A data final deve ser igual ou posterior à data inicial.',
});
export type LessonListQuery = z.infer<typeof lessonListQuery>;
export function parseLessonList(query: unknown, allowCalendar = false) {
  const result = lessonListQuery.safeParse(query);
  if (result.success) {
    if (result.data.view === 'calendar' && !allowCalendar)
      throw new AppError(400, 'INVALID_LIST_FILTERS', 'Calendário disponível na consulta de aulas da turma.');
    return result.data;
  }
  const labels: Record<string, string> = {
    page: 'Página: informe um inteiro entre 1 e 1000000.',
    pageSize: 'Tamanho da página: informe um inteiro entre 1 e 50.',
    view: 'Selecione lista ou calendário.', month: 'Informe um mês válido no formato AAAA-MM.',
    scope: 'Selecione próximas aulas, histórico ou todas.',
    mode: 'Selecione piloto ou oficial.', status: 'Selecione uma situação válida.',
    from: 'Data inicial: informe uma data válida no formato AAAA-MM-DD.',
    to: 'Data final: informe uma data válida, igual ou posterior à data inicial.',
  };
  const fieldErrors = result.error.issues.map((issue) => ({ field: String(issue.path[0] ?? ''),
    message: labels[String(issue.path[0])] ?? 'Filtro não reconhecido.' }));
  throw new AppError(400, 'INVALID_LIST_FILTERS', fieldErrors.map((e) => e.message).join(' '), fieldErrors);
}

// One statement: page, count and frequency share the same PostgreSQL snapshot.
// Only the bounded page is serialized; the global frequency is aggregated in SQL.
export async function listLessons(c: pg.PoolClient, offeringId: string, accountId: string,
  manages: boolean, q: LessonListQuery, history = false) {
  const result = await c.query(`WITH base AS (
    SELECT l.*, x.name AS location_name, r.status, r.source,
      CASE WHEN r.manual THEN 'Registro definido manualmente.' ELSE r.reason END AS reason,
      (s.first_closed_at IS NOT NULL AND l.cancelled_at IS NULL) AS included,
      l.cancelled_at IS NOT NULL AS cancelled,
      EXISTS (SELECT 1 FROM attendance_openings o WHERE o.session_id=s.id
        AND o.closed_at IS NULL AND o.expires_at>statement_timestamp()) AS reopened,
      CASE WHEN l.cancelled_at IS NOT NULL THEN 'CANCELLED'
        WHEN EXISTS (SELECT 1 FROM attendance_openings o WHERE o.session_id=s.id
          AND o.closed_at IS NULL AND o.expires_at>statement_timestamp()) THEN 'OPEN'
        WHEN EXISTS (SELECT 1 FROM attendance_openings o WHERE o.session_id=s.id) THEN 'CLOSED'
        ELSE 'NOT_OPENED' END AS attendance_status
    FROM lessons l JOIN locations x ON x.id=l.location_id
    LEFT JOIN attendance_sessions s ON s.lesson_id=l.id
    LEFT JOIN attendance_records r ON r.lesson_id=l.id AND r.account_id=$2
    WHERE l.offering_id=$1 AND ($3 OR EXISTS (SELECT 1 FROM enrollments e
      WHERE e.offering_id=l.offering_id AND e.account_id=$2 AND e.enrolled_at<=l.starts_at
      AND (e.ended_at IS NULL OR e.ended_at>l.starts_at)))
  ), filtered AS (
    SELECT * FROM base WHERE
      ($4='all' OR ($4='upcoming' AND ends_at>statement_timestamp()) OR ($4='past' AND ends_at<=statement_timestamp()))
      AND ($5::text IS NULL OR attendance_mode=$5)
      AND ($6::text IS NULL OR CASE WHEN $6 IN ('PRESENT','ABSENT','PENDING','NONE')
        THEN COALESCE(status,'NONE')=$6 ELSE attendance_status=$6 END)
      AND ($7::date IS NULL OR (starts_at AT TIME ZONE (SELECT time_zone FROM installation))::date >= $7)
      AND ($8::date IS NULL OR (starts_at AT TIME ZONE (SELECT time_zone FROM installation))::date <= $8)
      AND (NOT $12::boolean OR to_char(starts_at AT TIME ZONE (SELECT time_zone FROM installation),'YYYY-MM') =
        COALESCE($11::text,to_char(statement_timestamp() AT TIME ZONE (SELECT time_zone FROM installation),'YYYY-MM')))
  ), totals AS (SELECT count(*)::int AS total FROM filtered), paging AS (
    SELECT total, GREATEST(1,ceil(total::numeric/$10::int)::int) AS pages,
      LEAST($9::int,GREATEST(1,ceil(total::numeric/$10::int)::int)) AS page FROM totals
  ), page_rows AS (
    SELECT * FROM filtered ORDER BY
      CASE WHEN $4='past' THEN starts_at END DESC,
      CASE WHEN $4<>'past' THEN starts_at END ASC, id
    LIMIT $10::int OFFSET ((SELECT page FROM paging)-1)*$10::int
  )
  ${q.view === 'calendar' ? `SELECT
    COALESCE($11::text,to_char(statement_timestamp() AT TIME ZONE (SELECT time_zone FROM installation),'YYYY-MM')) AS month,
    COALESCE((SELECT json_agg(d ORDER BY d.date) FROM (
      SELECT (starts_at AT TIME ZONE (SELECT time_zone FROM installation))::date::text AS date,
        count(*)::int AS total FROM filtered GROUP BY 1
    ) d),'[]') AS days` : `SELECT (SELECT row_to_json(p) FROM paging p) AS pagination,
    COALESCE((SELECT json_agg(${history ? 'to_jsonb(p)' : "to_jsonb(p) - ARRAY['status','source','reason','included','cancelled','reopened']"}) FROM page_rows p),'[]') AS items
    ${history ? `, (SELECT json_agg(f) FROM (
      SELECT m.mode,
        count(*) FILTER (WHERE b.included AND b.status='PRESENT')::int AS present,
        count(*) FILTER (WHERE b.included AND b.status='ABSENT')::int AS absent,
        count(*) FILTER (WHERE NOT b.cancelled AND b.status='PENDING')::int AS pending,
        COALESCE(bool_or((NOT b.cancelled AND b.status='PENDING') OR (b.included AND b.reopened)),false) AS provisional
      FROM (VALUES ('PILOT'),('OFFICIAL')) m(mode) LEFT JOIN base b ON b.attendance_mode=m.mode
      GROUP BY m.mode ORDER BY m.mode DESC
    ) f) AS frequency` : ''}`}`,
    [offeringId, accountId, manages, q.scope, q.mode ?? null, q.status ?? null,
      q.from ?? null, q.to ?? null, q.page, q.pageSize, q.month ?? null, q.view === 'calendar']);
  const row = result.rows[0];
  return q.view === 'calendar' ? row : { ...row, pagination: { ...row.pagination, pageSize: q.pageSize } };
}
