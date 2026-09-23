import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { audit } from '../audit.js';
import type { Principal } from '../identity/authorization.js';
import { AppError } from '../platform/errors.js';
import { adminOnly, checkVersion, isAdmin, managed, notFound, teachingOffering } from './access.js';
import { plannedInstant, policySnapshot } from './domain.js';

const uuid = z.uuid();
const title = z.string().trim().min(2).max(160);
const description = z.string().trim().max(2000).default('');
const version = z.number().int().positive();
const mode = z.enum(['PILOT', 'OFFICIAL']);
const disciplineSchema = z.strictObject({ name: title, description });
const locationSchema = z.strictObject({
  name: title,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius: z.number().positive(),
  geoRequired: z.boolean(),
});
const offeringSchema = z.strictObject({
  disciplineId: uuid,
  name: title,
  term: title,
  shift: title,
  attendanceMode: mode,
});
const lessonSchema = z.strictObject({
  offeringId: uuid,
  locationId: uuid,
  title,
  description,
  startsLocal: z.string().max(19),
  endsLocal: z.string().max(19),
  attendanceMode: mode,
});
const routeId = (r: FastifyRequest) => uuid.parse((r.params as { id: string }).id);
const role = (p: Principal) =>
  p.roles.includes('OWNER') ? 'OWNER' : isAdmin(p) ? 'ADMIN' : 'PROFESSOR';
async function event(
  c: pg.PoolClient,
  p: Principal,
  action: string,
  targetId: string,
  details: Record<string, unknown> = {},
) {
  await audit(c, { actorId: p.id, actorRole: role(p), action, targetId, details });
}
async function requiredRole(c: pg.PoolClient, id: string, role: string) {
  if (
    !(
      await c.query(
        'SELECT 1 FROM accounts a JOIN account_roles r ON r.account_id=a.id WHERE a.id=$1 AND r.role=$2 AND a.active',
        [id, role],
      )
    ).rowCount
  ) {
    throw new AppError(400, 'INVALID_ACCOUNT_ROLE', `Selecione uma conta ativa com papel ${role}.`);
  }
}
async function zone(c: pg.PoolClient) {
  return (await c.query('SELECT time_zone FROM installation')).rows[0].time_zone as string;
}

export function registerAcademic(
  app: FastifyInstance,
  pool: pg.Pool,
  token: (r: FastifyRequest) => string | undefined,
) {
  app.get('/api/catalog', (r) =>
    managed(pool, token(r), async (c, p) => {
      if (!isAdmin(p) && !p.roles.includes('PROFESSOR'))
        throw new AppError(403, 'FORBIDDEN', 'Catálogo restrito à equipe docente e administração.');
      return {
        disciplines: (await c.query('SELECT * FROM disciplines ORDER BY name,id')).rows,
        locations: (await c.query('SELECT * FROM locations ORDER BY name,id')).rows,
      };
    }),
  );
  app.post('/api/disciplines', async (r, reply) => {
    const input = disciplineSchema.parse(r.body);
    const result = await managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      const id = randomUUID();
      await c.query('INSERT INTO disciplines(id,name,description) VALUES ($1,$2,$3)', [
        id,
        input.name,
        input.description,
      ]);
      await event(c, p, 'DISCIPLINE_CREATED', id);
      return { id };
    });
    return reply.code(201).send(result);
  });
  app.post('/api/disciplines/:id', async (r) => {
    const id = routeId(r),
      input = disciplineSchema.extend({ version }).parse(r.body);
    return managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      const before = (await c.query('SELECT * FROM disciplines WHERE id=$1', [id])).rows[0];
      if (!before) notFound();
      checkVersion(before.version, input.version);
      await c.query('UPDATE disciplines SET name=$2,description=$3,version=version+1 WHERE id=$1', [
        id,
        input.name,
        input.description,
      ]);
      await event(c, p, 'DISCIPLINE_UPDATED', id, { before, after: input });
      return { updated: true };
    });
  });
  app.post('/api/locations', async (r, reply) => {
    const input = locationSchema.parse(r.body);
    const result = await managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      const id = randomUUID();
      await c.query(
        'INSERT INTO locations(id,name,latitude,longitude,radius,geo_required) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, input.name, input.latitude, input.longitude, input.radius, input.geoRequired],
      );
      await event(c, p, 'LOCATION_CREATED', id, { after: input });
      return { id };
    });
    return reply.code(201).send(result);
  });
  app.post('/api/locations/:id', async (r) => {
    const id = routeId(r),
      input = locationSchema.extend({ version }).parse(r.body);
    return managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      const before = (await c.query('SELECT * FROM locations WHERE id=$1', [id])).rows[0];
      if (!before) notFound();
      checkVersion(before.version, input.version);
      await c.query(
        'UPDATE locations SET name=$2,latitude=$3,longitude=$4,radius=$5,geo_required=$6,version=version+1 WHERE id=$1',
        [id, input.name, input.latitude, input.longitude, input.radius, input.geoRequired],
      );
      await event(c, p, 'LOCATION_UPDATED', id, { before, after: input });
      return { updated: true };
    });
  });
  app.get('/api/offerings', (r) =>
    managed(
      pool,
      token(r),
      async (c, p) =>
        (
          await c.query(
            `SELECT o.*,d.name AS discipline_name,
    ($1 OR ($2 AND EXISTS (SELECT 1 FROM offering_teachers t WHERE t.offering_id=o.id AND t.account_id=$3))) AS can_manage,
    ($4 AND EXISTS (SELECT 1 FROM enrollments e WHERE e.offering_id=o.id AND e.account_id=$3)) AS can_view_history
    FROM offerings o JOIN disciplines d ON d.id=o.discipline_id
    WHERE $1 OR ($2 AND EXISTS (SELECT 1 FROM offering_teachers t WHERE t.offering_id=o.id AND t.account_id=$3))
    OR ($4 AND EXISTS (SELECT 1 FROM enrollments e WHERE e.offering_id=o.id AND e.account_id=$3)) ORDER BY o.name,o.id`,
            [isAdmin(p), p.roles.includes('PROFESSOR'), p.id, p.roles.includes('STUDENT')],
          )
        ).rows,
    ),
  );
  app.post('/api/offerings', async (r, reply) => {
    const input = offeringSchema.parse(r.body);
    const result = await managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      const id = randomUUID();
      await c.query(
        'INSERT INTO offerings(id,discipline_id,name,term,shift,attendance_mode) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, input.disciplineId, input.name, input.term, input.shift, input.attendanceMode],
      );
      await event(c, p, 'OFFERING_CREATED', id, { after: input });
      return { id };
    });
    return reply.code(201).send(result);
  });
  app.post('/api/offerings/:id', async (r) => {
    const id = routeId(r),
      input = z
        .strictObject({ name: title, term: title, shift: title, attendanceMode: mode, version })
        .parse(r.body);
    return managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      const before = await teachingOffering(c, p, id, true);
      checkVersion(before.version, input.version);
      await c.query(
        'UPDATE offerings SET name=$2,term=$3,shift=$4,attendance_mode=$5,version=version+1 WHERE id=$1',
        [id, input.name, input.term, input.shift, input.attendanceMode],
      );
      // Changing a default does not silently rewrite existing planned lessons.
      await event(c, p, 'OFFERING_UPDATED', id, {
        before,
        after: input,
        existingLessonsChanged: false,
      });
      return { updated: true };
    });
  });
  app.get('/api/offerings/:id/members', (r) =>
    managed(pool, token(r), async (c, p) => {
      const id = routeId(r);
      await teachingOffering(c, p, id);
      return {
        teachers: (
          await c.query(
            `SELECT t.account_id,p.name FROM offering_teachers t JOIN account_profiles p ON p.account_id=t.account_id WHERE t.offering_id=$1 ORDER BY p.name`,
            [id],
          )
        ).rows,
        enrollments: (
          await c.query(
            `SELECT e.*,p.name,(e.ended_at IS NULL OR e.ended_at > clock_timestamp()) AS can_end FROM enrollments e JOIN account_profiles p ON p.account_id=e.account_id WHERE e.offering_id=$1 ORDER BY p.name,e.enrolled_at`,
            [id],
          )
        ).rows,
      };
    }),
  );
  app.post('/api/offerings/:id/teachers', async (r) => {
    const id = routeId(r),
      input = z
        .strictObject({
          teacherIds: z
            .array(uuid)
            .max(100)
            .refine((v) => new Set(v).size === v.length),
          version,
        })
        .parse(r.body);
    return managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      const offering = await teachingOffering(c, p, id, true);
      checkVersion(offering.version, input.version);
      for (const teacherId of input.teacherIds) await requiredRole(c, teacherId, 'PROFESSOR');
      const before = (
        await c.query(
          'SELECT account_id FROM offering_teachers WHERE offering_id=$1 ORDER BY account_id',
          [id],
        )
      ).rows.map((v) => v.account_id);
      await c.query('DELETE FROM offering_teachers WHERE offering_id=$1', [id]);
      for (const teacherId of input.teacherIds)
        await c.query('INSERT INTO offering_teachers(offering_id,account_id) VALUES ($1,$2)', [
          id,
          teacherId,
        ]);
      await c.query('UPDATE offerings SET version=version+1 WHERE id=$1', [id]);
      await event(c, p, 'TEACHERS_ASSIGNED', id, { before, after: input.teacherIds });
      return { updated: true };
    });
  });
  app.post('/api/offerings/:id/enrollments', async (r, reply) => {
    const offeringId = routeId(r),
      input = z
        .strictObject({
          accountId: uuid,
          enrolledLocal: z.string().max(19),
          endedLocal: z.string().max(19).nullable(),
        })
        .parse(r.body);
    const result = await managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      await teachingOffering(c, p, offeringId, true);
      await requiredRole(c, input.accountId, 'STUDENT');
      const timeZone = await zone(c);
      const start = plannedInstant(input.enrolledLocal, timeZone, 'enrolledLocal'),
        end = input.endedLocal ? plannedInstant(input.endedLocal, timeZone, 'endedLocal') : null;
      if (end && Date.parse(end) <= Date.parse(start))
        throw new AppError(
          400,
          'INVALID_INTERVAL',
          'O término da matrícula deve ser posterior ao início.',
          [
            {
              field: 'endedLocal',
              message: 'Término da matrícula: informe uma data/hora posterior ao início.',
            },
          ],
        );
      if (
        (
          await c.query(
            `SELECT 1 FROM lessons WHERE offering_id=$1 AND context_locked_at IS NOT NULL AND starts_at >= $2 AND ($3::timestamptz IS NULL OR starts_at<$3) LIMIT 1`,
            [offeringId, start, end],
          )
        ).rowCount
      )
        throw new AppError(
          409,
          'HISTORICAL_ENROLLMENT',
          'A matrícula alteraria participação em uma aula com contexto já fixado.',
        );
      const id = randomUUID();
      await c.query(
        'INSERT INTO enrollments(id,offering_id,account_id,enrolled_at,ended_at) VALUES ($1,$2,$3,$4,$5)',
        [id, offeringId, input.accountId, start, end],
      );
      await event(c, p, 'ENROLLMENT_CREATED', id, {
        offeringId,
        accountId: input.accountId,
        enrolledAt: start,
        endedAt: end,
      });
      return { id };
    });
    return reply.code(201).send(result);
  });
  app.post('/api/enrollments/:id/end', async (r) => {
    const id = routeId(r),
      input = z.strictObject({ endedLocal: z.string().max(19), version }).parse(r.body);
    return managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      const before = (await c.query('SELECT * FROM enrollments WHERE id=$1', [id])).rows[0];
      if (!before) notFound();
      checkVersion(before.version, input.version);
      const now = (await c.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
      if (before.ended_at && before.ended_at.getTime() <= now.getTime())
        throw new AppError(
          409,
          'ENROLLMENT_ALREADY_ENDED',
          'Este período já foi encerrado. Um retorno exige nova matrícula.',
        );
      const end = plannedInstant(input.endedLocal, await zone(c), 'endedLocal');
      if (before.ended_at && Date.parse(end) >= before.ended_at.getTime())
        throw new AppError(400, 'INVALID_INTERVAL', 'Informe um término anterior ao já programado.', [
          { field: 'endedLocal', message: 'Término da matrícula: o encerramento deve antecipar a data já programada.' },
        ]);
      if (Date.parse(end) <= before.enrolled_at.getTime())
        throw new AppError(400, 'INVALID_INTERVAL', 'O término deve ser posterior ao início.', [
          {
            field: 'endedLocal',
            message: 'Término da matrícula: informe uma data/hora posterior ao início.',
          },
        ]);
      if (
        (
          await c.query(
            'SELECT 1 FROM lessons WHERE offering_id=$1 AND context_locked_at IS NOT NULL AND starts_at >= $2 AND ($3::timestamptz IS NULL OR starts_at < $3) LIMIT 1',
            [before.offering_id, end, before.ended_at],
          )
        ).rowCount
      )
        throw new AppError(
          409,
          'HISTORICAL_ENROLLMENT',
          'O encerramento alteraria participação em uma aula com contexto já fixado.',
        );
      await c.query('UPDATE enrollments SET ended_at=$2,version=version+1 WHERE id=$1', [id, end]);
      await event(c, p, 'ENROLLMENT_ENDED', id, {
        before: { endedAt: before.ended_at?.toISOString() ?? null, version: before.version },
        after: { endedAt: end, version: before.version + 1 },
        offeringId: before.offering_id,
      });
      return { updated: true };
    });
  });
  app.get('/api/offerings/:id/lessons', (r) =>
    managed(pool, token(r), async (c, p) => {
      const id = routeId(r);
      const teaches =
        isAdmin(p) ||
        (p.roles.includes('PROFESSOR') &&
          !!(
            await c.query(
              'SELECT 1 FROM offering_teachers WHERE offering_id=$1 AND account_id=$2',
              [id, p.id],
            )
          ).rowCount);
      if (
        !teaches &&
        (!p.roles.includes('STUDENT') ||
          !(
            await c.query('SELECT 1 FROM enrollments WHERE offering_id=$1 AND account_id=$2', [
              id,
              p.id,
            ])
          ).rowCount)
      )
        notFound();
      return (
        await c.query(
          `SELECT l.*,x.name AS location_name FROM lessons l JOIN locations x ON x.id=l.location_id WHERE l.offering_id=$1 AND
      ($2 OR EXISTS (SELECT 1 FROM enrollments e WHERE e.offering_id=l.offering_id AND e.account_id=$3 AND e.enrolled_at<=l.starts_at AND (e.ended_at IS NULL OR e.ended_at>l.starts_at))) ORDER BY l.starts_at,l.id`,
          [id, teaches, p.id],
        )
      ).rows;
    }),
  );
  async function saveLesson(r: FastifyRequest, existing: boolean) {
    const input = (existing ? lessonSchema.extend({ version }) : lessonSchema).parse(r.body);
    return managed(pool, token(r), async (c, p) => {
      const id = existing ? routeId(r) : randomUUID();
      const before = existing
        ? (await c.query('SELECT * FROM lessons WHERE id=$1', [id])).rows[0]
        : null;
      if (existing && !before) notFound();
      if (before?.cancelled_at) throw new AppError(409, 'LESSON_CANCELLED', 'A aula cancelada permanece no histórico e não pode ser replanejada.');
      if (before) {
        await teachingOffering(c, p, before.offering_id, true);
        checkVersion(before.version, version.parse('version' in input ? input.version : undefined));
      }
      await teachingOffering(c, p, input.offeringId, true);
      const timeZone = await zone(c),
        start = plannedInstant(input.startsLocal, timeZone, 'startsLocal'),
        end = plannedInstant(input.endsLocal, timeZone, 'endsLocal');
      if (Date.parse(end) <= Date.parse(start))
        throw new AppError(
          400,
          'INVALID_INTERVAL',
          'O término da aula deve ser posterior ao início.',
          [
            {
              field: 'endsLocal',
              message: 'Fim da aula: informe uma data/hora posterior ao início.',
            },
          ],
        );
      const location = (await c.query('SELECT * FROM locations WHERE id=$1', [input.locationId]))
        .rows[0];
      if (!location) notFound();
      if (
        before?.context_locked_at &&
        (before.offering_id !== input.offeringId ||
          before.starts_at.toISOString() !== new Date(start).toISOString() ||
          before.ends_at.toISOString() !== new Date(end).toISOString())
      )
        throw new AppError(
          409,
          'LESSON_CONTEXT_LOCKED',
          'O contexto da aula já foi fixado e não pode ser reescrito.',
        );
      if (
        before &&
        (before.context_locked_at || before.mode_locked_at) &&
        before.attendance_mode !== input.attendanceMode
      )
        throw new AppError(409, 'LESSON_MODE_LOCKED', 'O modo desta aula já está fixado.');
      if (before?.context_locked_at && before.location_id !== input.locationId)
        throw new AppError(
          409,
          'LOCATION_CHANGE_REQUIRES_ATTENDANCE_FLOW',
          'A mudança exige o fluxo auditado de chamada fechada, disponível junto à chamada.',
        );
      if (existing)
        await c.query(
          'UPDATE lessons SET offering_id=$2,location_id=$3,title=$4,description=$5,starts_at=$6,ends_at=$7,attendance_mode=$8,version=version+1 WHERE id=$1',
          [
            id,
            input.offeringId,
            input.locationId,
            input.title,
            input.description,
            start,
            end,
            input.attendanceMode,
          ],
        );
      else
        await c.query(
          'INSERT INTO lessons(id,offering_id,location_id,title,description,starts_at,ends_at,attendance_mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            id,
            input.offeringId,
            input.locationId,
            input.title,
            input.description,
            start,
            end,
            input.attendanceMode,
          ],
        );
      await event(c, p, existing ? 'LESSON_UPDATED' : 'LESSON_CREATED', id, {
        before,
        after: { ...input, startsAt: start, endsAt: end, timeZone },
      });
      return { id };
    });
  }
  app.post('/api/lessons', async (r, reply) => reply.code(201).send(await saveLesson(r, false)));
  app.post('/api/lessons/:id', (r) => saveLesson(r, true));
  app.get('/api/lessons/:id/planning', (r) =>
    managed(pool, token(r), async (c, p) => {
      const id = routeId(r),
        lesson = (await c.query('SELECT * FROM lessons WHERE id=$1', [id])).rows[0];
      if (!lesson) notFound();
      await teachingOffering(c, p, lesson.offering_id);
      const location = (await c.query('SELECT * FROM locations WHERE id=$1', [lesson.location_id]))
        .rows[0];
      const students = (
        await c.query(
          `SELECT e.account_id,p.name FROM enrollments e JOIN account_profiles p ON p.account_id=e.account_id
      WHERE e.offering_id=$1 AND e.enrolled_at<=$2 AND (e.ended_at IS NULL OR e.ended_at>$2) ORDER BY p.name`,
          [lesson.offering_id, lesson.starts_at],
        )
      ).rows;
      return { lesson, students, policyPreview: policySnapshot(location), previewOnly: true };
    }),
  );
}
