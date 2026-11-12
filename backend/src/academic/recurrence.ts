import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { plannedInstant } from './domain.js';
import { managed, teachingOffering, notFound } from './access.js';
import { AppError } from '../platform/errors.js';
import { audit } from '../audit.js';

export const recurrenceSchema = z.strictObject({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).transform(v => [...new Set(v)].sort()),
  starts: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  ends: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).default(''),
  locationId: z.uuid(),
  attendanceMode: z.enum(['PILOT', 'OFFICIAL']),
});
type Rule = z.infer<typeof recurrenceSchema>;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function invalid(field: string, message: string): never {
  throw new AppError(400, 'INVALID_RECURRENCE', message, [{ field, message }]);
}
export function expandRecurrence(rule: Rule, timeZone: string) {
  const date = (value: string, field: string) => {
    const ms = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) invalid(field, 'Informe uma data válida.');
    return ms;
  };
  const from = date(rule.from, 'from'), until = date(rule.until, 'until');
  if (until < from || until - from > 365 * 86400000) invalid('until', 'O período deve ter de 1 a 366 dias. Divida períodos maiores em lotes.');
  if (rule.starts === rule.ends) invalid('ends', 'Início e fim devem ser diferentes.');
  const occurrences = [];
  for (let ms = from; ms <= until; ms += 86400000) {
    if (!rule.weekdays.includes(new Date(ms).getUTCDay())) continue;
    const day = new Date(ms).toISOString().slice(0, 10);
    const endDay = new Date(ms + (rule.ends < rule.starts ? 86400000 : 0)).toISOString().slice(0, 10);
    const startsAt = plannedInstant(`${day}T${rule.starts}`, timeZone, 'starts');
    const endsAt = plannedInstant(`${endDay}T${rule.ends}`, timeZone, 'ends');
    if (Date.parse(endsAt) <= Date.parse(startsAt)) invalid('ends', 'Término deve ocorrer após o início.');
    occurrences.push({ startsAt, endsAt });
  }
  if (!occurrences.length) invalid('weekdays', 'Nenhum dia selecionado ocorre neste período.');
  return occurrences;
}

export function registerRecurrence(app: FastifyInstance, pool: pg.Pool, token: (r: FastifyRequest) => string | undefined) {
  for (const generate of [false, true]) app.post(`/api/offerings/:id/recurrence/${generate ? 'generate' : 'preview'}`, r => {
    const id = z.uuid().parse((r.params as { id: string }).id);
    const parsed = (generate ? recurrenceSchema.extend({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) }) : recurrenceSchema).parse(r.body);
    const rule = recurrenceSchema.parse(Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'previewHash')));
    return managed(pool, token(r), async (c, p) => {
      const offering = await teachingOffering(c, p, id, true);
      const timeZone = (await c.query('SELECT time_zone FROM installation')).rows[0].time_zone as string;
      const location = (await c.query('SELECT id,version FROM locations WHERE id=$1', [rule.locationId])).rows[0];
      if (!location) notFound();
      const occurrences = expandRecurrence(rule, timeZone);
      const requestHash = hash({ rule, timeZone });
      const previous = (await c.query('SELECT id,result FROM lesson_generations WHERE offering_id=$1 AND request_hash=$2', [id, requestHash])).rows[0];
      if (generate && previous) return { ...previous.result, replayed: true };
      const plan = [];
      for (const occurrence of occurrences) {
        const used = (await c.query(`SELECT lesson_id AS id FROM generated_occurrences WHERE offering_id=$1 AND original_start=$2
          UNION ALL SELECT id FROM lessons WHERE offering_id=$1 AND starts_at=$2`, [id, occurrence.startsAt])).rows;
        plan.push({ ...occurrence, action: used.length ? 'KEEP' : 'CREATE' });
      }
      const previewHash = hash({ requestHash, offeringVersion: offering.version, locationVersion: location.version, plan });
      if (!generate) return { timeZone, previewHash, occurrences: plan, createCount: plan.filter(o => o.action === 'CREATE').length };
      if (!('previewHash' in parsed) || parsed.previewHash !== previewHash)
        throw new AppError(409, 'PREVIEW_CHANGED', 'O planejamento mudou. Gere uma nova prévia antes de confirmar.');
      const generationId = randomUUID();
      const result = { generationId, created: plan.filter(o => o.action === 'CREATE').length, kept: plan.filter(o => o.action === 'KEEP').length };
      await c.query('INSERT INTO lesson_generations(id,offering_id,request_hash,rule,time_zone,result,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [generationId, id, requestHash, rule, timeZone, result, p.id]);
      for (const occurrence of plan) {
        if (occurrence.action !== 'CREATE') continue;
        const lessonId = randomUUID();
        await c.query('INSERT INTO lessons(id,offering_id,location_id,title,description,starts_at,ends_at,attendance_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [lessonId, id, rule.locationId, rule.title, rule.description, occurrence.startsAt, occurrence.endsAt, rule.attendanceMode]);
        await c.query('INSERT INTO generated_occurrences(offering_id,original_start,generation_id,lesson_id) VALUES($1,$2,$3,$4)', [id, occurrence.startsAt, generationId, lessonId]);
        await audit(c, { actorId: p.id, actorRole: p.roles.includes('OWNER') ? 'OWNER' : p.roles.includes('ADMIN') ? 'ADMIN' : 'PROFESSOR', action: 'LESSON_CREATED', targetId: lessonId, details: { generationId, after: { ...rule, ...occurrence, timeZone, offeringId: id } } });
      }
      await audit(c, { actorId: p.id, actorRole: p.roles.includes('OWNER') ? 'OWNER' : p.roles.includes('ADMIN') ? 'ADMIN' : 'PROFESSOR', action: 'LESSONS_GENERATED', targetId: generationId, details: { rule, timeZone, offeringId: id, ...result } });
      return result;
    });
  });
}
