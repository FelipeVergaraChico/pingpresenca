import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { adminOnly, checkVersion, managed } from '../academic/access.js';
import { audit } from '../audit.js';
import { AppError } from '../platform/errors.js';
import type { Config } from '../config.js';
import {
  attendanceView,
  attemptResult,
  authorize,
  closeAttendance,
  confirm,
  inLesson,
  manualDecision,
  openAttendance,
  projection,
  studentHistory,
  cancelLesson,
  changeAttendanceLocation,
} from './service.js';

const id = (r: FastifyRequest) => z.uuid().parse((r.params as { id: string }).id);
const reason = z.string().trim().min(3).max(1000);
const minutes = z.number().int().min(1).max(1440);
const geo = z.union([
  z.strictObject({
    status: z.literal('AVAILABLE'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0),
  }),
  z.strictObject({ status: z.enum(['DENIED', 'UNAVAILABLE', 'TIMEOUT']) }),
]);
export function registerAttendance(
  app: FastifyInstance,
  pool: pg.Pool,
  config: Config,
  token: (r: FastifyRequest) => string | undefined,
) {
  app.get('/api/attendance/settings', (r) =>
    managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      return (
        await c.query(
          'SELECT attendance_minutes AS minutes,attendance_settings_version AS version FROM installation',
        )
      ).rows[0];
    }),
  );
  app.post('/api/attendance/settings', (r) => {
    const input = z
      .strictObject({ minutes, version: z.number().int().positive(), reason })
      .parse(r.body);
    return managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      const before = (
        await c.query(
          'SELECT attendance_minutes AS minutes,attendance_settings_version AS version FROM installation',
        )
      ).rows[0];
      checkVersion(before.version, input.version);
      await c.query(
        'UPDATE installation SET attendance_minutes=$1,attendance_settings_version=attendance_settings_version+1',
        [input.minutes],
      );
      await audit(c, {
        actorId: p.id,
        actorRole: 'ADMINISTRATIVE',
        action: 'ATTENDANCE_SETTINGS_CHANGED',
        targetId: p.id,
        details: {
          before,
          after: { minutes: input.minutes, version: input.version + 1 },
          reason: input.reason,
        },
      });
      return { updated: true };
    });
  });
  app.get('/api/attendance/:id', (r) => inLesson(pool, token(r), id(r), attendanceView));
  app.get('/api/attendance/:id/projection', (r) =>
    inLesson(pool, token(r), id(r), (ctx) => projection(ctx, config.publicOrigin)),
  );
  app.post('/api/attendance/:id/open', (r) => {
    const input = z
      .strictObject({ minutes: minutes.optional(), reason: reason.optional() })
      .parse(r.body);
    return inLesson(
      pool,
      token(r),
      id(r),
      (ctx) => openAttendance(ctx, input.minutes, input.reason ?? ''),
      true,
    );
  });
  app.post('/api/attendance/:id/close', (r) => {
    const input = z.strictObject({ reason: reason.optional(), openingId: z.uuid() }).parse(r.body);
    return inLesson(pool, token(r), id(r), (ctx) => closeAttendance(ctx, input.reason ?? '', input.openingId));
  });
  app.post('/api/attendance/:id/reopen', (r) => {
    const input = z.strictObject({ minutes: minutes.optional(), reason, openingId: z.uuid() }).parse(r.body);
    return inLesson(pool, token(r), id(r), ctx => openAttendance(ctx, input.minutes, input.reason, { openingId: input.openingId }), true);
  });
  app.post('/api/attendance/:id/cancel', (r) => {
    const input = z.strictObject({ version: z.number().int().positive(), reason }).parse(r.body);
    return inLesson(pool, token(r), id(r), ctx => cancelLesson(ctx, input.version, input.reason), true, false);
  });
  app.post('/api/attendance/:id/location', (r) => {
    const input = z.strictObject({ version: z.number().int().positive(), reason, locationId: z.uuid() }).parse(r.body);
    return inLesson(pool, token(r), id(r), ctx => changeAttendanceLocation(ctx, input.version, input.locationId, input.reason), true);
  });
  app.post('/api/attendance/:id/authorize', async (r) => {
    const parsed = z
      .union([
        z.strictObject({ code: z.string().regex(/^\d{6}$/) }),
        z.strictObject({ qr: z.string().regex(/^[\w-]{43}$/) }),
      ])
      .safeParse(r.body);
    if (!parsed.success)
      throw new AppError(
        400,
        'INVALID_CODE_FORMAT',
        'Informe o código de seis dígitos ou leia novamente o QR atual.',
        [
          {
            field: 'code',
            message: 'Código da chamada: informe exatamente seis dígitos, sem espaços ou letras.',
          },
        ],
      );
    const result = await inLesson(pool, token(r), id(r), (ctx) => authorize(ctx, parsed.data));
    if ('error' in result) throw result.error;
    return result;
  });
  app.post('/api/attendance/:id/confirm', (r) => {
    const input = z.strictObject({ token: z.string().regex(/^[\w-]{43}$/), geo }).parse(r.body);
    return inLesson(pool, token(r), id(r), (ctx) => confirm(ctx, input.token, input.geo));
  });
  app.post('/api/attendance/:id/result', (r) => {
    const input = z.strictObject({ token: z.string().regex(/^[\w-]{43}$/) }).parse(r.body);
    return inLesson(pool, token(r), id(r), (ctx) => attemptResult(ctx, input.token));
  });
  app.post('/api/attendance/:id/decision', (r) => {
    const input = z
      .strictObject({
        accountId: z.uuid(),
        version: z.number().int().min(0),
        status: z.enum(['PRESENT', 'ABSENT']),
        kind: z.enum(['MANUAL', 'PENDING_DECISION', 'CORRECTION']),
        reason,
      })
      .parse(r.body);
    return inLesson(pool, token(r), id(r), (ctx) => manualDecision(ctx, input));
  });
  app.get('/api/attendance/history/:id', (r) => studentHistory(pool, token(r), id(r), r.query));
}
