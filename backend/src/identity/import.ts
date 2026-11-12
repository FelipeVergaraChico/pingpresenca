import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { adminOnly, managed, teachingOffering } from '../academic/access.js';
import { plannedInstant } from '../academic/domain.js';
import { issueManualInvitation } from './invitations.js';
import { audit } from '../audit.js';
import { AppError } from '../platform/errors.js';
import { digest } from './password.js';

// Deliberately bounded CSV dialect: comma separator, RFC-style quoted fields.
export function parseAccountCsv(source: string) {
  const fail = (): never => { throw new AppError(400, 'IMPORT_FORMAT', 'Use CSV com cabeçalho nome,email,identificador,papel, até 200 contas e 64 KiB. Confira as aspas e use vírgulas como separador.'); };
  if (Buffer.byteLength(source, 'utf8') > 65536) fail();
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === undefined) fail();
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += c;
    } else if (c === ',' || c === '\n' || c === undefined) {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { if (row.some(v => v !== '')) rows.push(row); row = []; }
    } else if (c === '"' && !field && !closed) quoted = true;
    else { if (closed || c === '"' || c === '\r') fail(); field += c; }
    if (rows.length > 201) fail();
  }
  if (rows.shift()?.join(',') !== 'nome,email,identificador,papel' || !rows.length) fail();
  return rows.map((cells, index) => {
    const [name = '', email = '', identifier = '', role = ''] = cells.map(v => v.trim());
    const errors: string[] = [];
    if (cells.length !== 4) errors.push('Informe exatamente quatro colunas.');
    if (name.length < 2 || name.length > 120) errors.push('Nome deve ter entre 2 e 120 caracteres.');
    if (!z.email().max(254).safeParse(email).success) errors.push('E-mail inválido.');
    if (identifier.length > 80) errors.push('Identificador deve ter até 80 caracteres.');
    if (!['ALUNO', 'PROFESSOR'].includes(role)) errors.push('Papel deve ser ALUNO ou PROFESSOR; privilégios administrativos não são importados.');
    return { record: index + 1, name, email: email.toLowerCase(), institutionalId: identifier || null,
      role: role === 'ALUNO' ? 'STUDENT' : 'PROFESSOR', errors };
  });
}

export function registerAccountImport(app: FastifyInstance, pool: pg.Pool, token: (r: FastifyRequest) => string | undefined, publicOrigin: string) {
  for (const operation of ['preview', 'confirm'] as const) {
    app.post(`/api/admin/accounts/import/${operation}`, { bodyLimit: 150000 }, async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return managed(pool, token(req), async (c, actor) => {
      adminOnly(actor);
      const body = z.object({ csv: z.string().max(65536), previewHash: z.string().length(64).optional(), requestId: z.uuid().optional(),
        offeringId: z.uuid().nullable().default(null), enrolledLocal: z.string().max(19).nullable().default(null), endedLocal: z.string().max(19).nullable().default(null) }).strict().parse(req.body);
      const rows = parseAccountCsv(body.csv);
      if (!body.offeringId && (body.enrolledLocal || body.endedLocal)) throw new AppError(400, 'IMPORT_TARGET', 'Selecione a turma antes de informar a vigência.');
      const requestHash = digest(JSON.stringify({ rows, offeringId: body.offeringId, enrolledLocal: body.enrolledLocal, endedLocal: body.endedLocal }));
      if (operation === 'confirm') {
        if (!body.requestId || !body.previewHash) throw new AppError(400, 'IMPORT_PREVIEW_REQUIRED', 'Revise a prévia antes de confirmar.');
        const previous = await c.query("SELECT actor_id, details FROM audit_events WHERE target_id=$1 AND action='ACCOUNTS_IMPORTED'", [body.requestId]);
        if (previous.rows.length) {
          const old = previous.rows[0];
          if (old.actor_id !== actor.id || old.details.requestHash !== requestHash) throw new AppError(409, 'IMPORT_CONFLICT', 'Esta confirmação pertence a outro lote. Gere uma nova prévia.');
          return { created: old.details.accountIds.length, batchId: body.requestId, replayed: true };
        }
      }
      const { rows: [settings] } = await c.query('SELECT institutional_id_required, settings_version, time_zone FROM installation');
      const offering = body.offeringId ? await teachingOffering(c, actor, body.offeringId, true) : null;
      let start: string | null = null, end: string | null = null;
      if (offering && rows.some(r => r.role === 'STUDENT')) {
        start = plannedInstant(body.enrolledLocal ?? '', settings.time_zone, 'enrolledLocal');
        end = body.endedLocal ? plannedInstant(body.endedLocal, settings.time_zone, 'endedLocal') : null;
        if (end && Date.parse(end) <= Date.parse(start)) throw new AppError(400, 'INVALID_INTERVAL', 'O término da matrícula deve ser posterior ao início.');
        if ((await c.query(`SELECT 1 FROM lessons WHERE offering_id=$1 AND context_locked_at IS NOT NULL AND starts_at >= $2 AND ($3::timestamptz IS NULL OR starts_at<$3) LIMIT 1`, [offering.id, start, end])).rowCount)
          throw new AppError(409, 'HISTORICAL_ENROLLMENT', 'A matrícula alteraria participação em uma aula com contexto já fixado. Escolha uma vigência posterior.');
      }
      const existing = await c.query('SELECT email, institutional_id FROM account_profiles WHERE email=ANY($1::text[]) OR institutional_id=ANY($2::text[])', [rows.map(r => r.email), rows.map(r => r.institutionalId).filter(Boolean)]);
      for (const row of rows) {
        if (settings.institutional_id_required && !row.institutionalId) row.errors.push('Identificador obrigatório nesta instalação.');
        if (rows.filter(r => r.email === row.email).length > 1 || existing.rows.some(r => r.email === row.email)) row.errors.push('E-mail repetido no lote ou já cadastrado.');
        if (row.institutionalId && (rows.filter(r => r.institutionalId === row.institutionalId).length > 1 || existing.rows.some(r => r.institutional_id === row.institutionalId))) row.errors.push('Identificador repetido no lote ou já cadastrado.');
      }
      if (offering) {
        const teacherCount = Number((await c.query('SELECT count(*) FROM offering_teachers WHERE offering_id=$1', [offering.id])).rows[0].count);
        if (teacherCount + rows.filter(r => r.role === 'PROFESSOR').length > 100) throw new AppError(400, 'TEACHER_LIMIT', 'A turma admite até 100 professores. Divida o lote ou revise a turma.');
      }
      const previewHash = digest(JSON.stringify({ rows, settings, offering, start, end }));
      if (operation === 'preview') return { rows, previewHash, valid: rows.every(r => !r.errors.length),
        target: offering ? { name: offering.name, enrolledAt: start, endedAt: end, timeZone: settings.time_zone } : null };
      if (body.previewHash !== previewHash || rows.some(r => r.errors.length)) throw new AppError(409, 'IMPORT_STALE', 'Os dados ou a política mudaram. Gere uma nova prévia e revise os erros.');
      const accountIds: string[] = [];
      for (const row of rows) {
        const id = randomUUID(); accountIds.push(id);
        await c.query('INSERT INTO accounts(id,password_hash) VALUES($1,NULL)', [id]);
        await c.query('INSERT INTO account_profiles(account_id,name,email,institutional_id) VALUES($1,$2,$3,$4)', [id, row.name, row.email, row.institutionalId]);
        await c.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [id, row.role]);
        await audit(c, { actorId: actor.id, actorRole: actor.roles.includes('OWNER') ? 'OWNER' : 'ADMIN', action: 'ACCOUNT_CREATED', targetId: id, details: { after: [row.role], invited: false, importId: body.requestId } });
        if (offering) {
          const actorRole = actor.roles.includes('OWNER') ? 'OWNER' : 'ADMIN';
          if (row.role === 'STUDENT') {
            const enrollmentId = randomUUID();
            await c.query('INSERT INTO enrollments(id,offering_id,account_id,enrolled_at,ended_at) VALUES($1,$2,$3,$4,$5)', [enrollmentId, offering.id, id, start, end]);
            await audit(c, { actorId: actor.id, actorRole, action: 'ENROLLMENT_CREATED', targetId: enrollmentId, details: { offeringId: offering.id, accountId: id, enrolledAt: start, endedAt: end, importId: body.requestId } });
          } else {
            await c.query('INSERT INTO offering_teachers(offering_id,account_id) VALUES($1,$2)', [offering.id, id]);
            await audit(c, { actorId: actor.id, actorRole, action: 'TEACHER_ASSIGNED', targetId: offering.id, details: { accountId: id, before: false, after: true, importId: body.requestId } });
          }
        }
      }
      if (offering) await c.query('UPDATE offerings SET version=version+1 WHERE id=$1', [offering.id]);
      await audit(c, { actorId: actor.id, actorRole: actor.roles.includes('OWNER') ? 'OWNER' : 'ADMIN', action: 'ACCOUNTS_IMPORTED', targetId: body.requestId!, details: { requestHash, accountIds, offeringId: body.offeringId } });
      return { created: accountIds.length, batchId: body.requestId, replayed: false };
      });
    });
  }
  app.post('/api/admin/accounts/import/:batchId/invitations', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return managed(pool, token(req), async (c, actor) => {
    adminOnly(actor);
    const { batchId } = z.object({ batchId: z.uuid() }).parse(req.params);
    const { requestId, replaceExisting } = z.strictObject({ requestId: z.uuid(), replaceExisting: z.boolean() }).parse(req.body);
    const batch = (await c.query("SELECT details FROM audit_events WHERE action='ACCOUNTS_IMPORTED' AND target_id=$1", [batchId])).rows[0];
    if (!batch) throw new AppError(404, 'NOT_FOUND', 'Lote não encontrado.');
    if ((await c.query("SELECT 1 FROM audit_events WHERE action='IMPORT_INVITATIONS_ISSUED' AND target_id=$1", [requestId])).rowCount)
      throw new AppError(409, 'INVITATION_RESULT_UNAVAILABLE', 'Esta emissão já foi concluída. Os links não são armazenados. Para substituí-los, confirme explicitamente uma nova emissão.');
    const targets = (await c.query(`SELECT a.id,a.active,a.password_hash,p.name,p.email,
      EXISTS(SELECT 1 FROM account_roles r WHERE r.account_id=a.id AND r.role IN ('ADMIN','OWNER')) AS privileged,
      EXISTS(SELECT 1 FROM invitations i WHERE i.account_id=a.id AND i.revoked_at IS NULL AND i.consumed_at IS NULL AND i.expires_at>clock_timestamp()) AS has_invite
      FROM accounts a JOIN account_profiles p ON p.account_id=a.id WHERE a.id=ANY($1::uuid[]) ORDER BY a.id`, [batch.details.accountIds])).rows;
    if (targets.some(t => t.privileged)) throw new AppError(409, 'PRIVILEGED_ACCOUNT', 'O lote contém conta administrativa. Gerencie seus convites individualmente.');
    const eligible = targets.filter(t => t.active && t.password_hash === null);
    if (!eligible.length) throw new AppError(409, 'NOT_INVITABLE', 'Nenhuma conta ativa deste lote aguarda aceite.');
    if (!replaceExisting && eligible.some(t => t.has_invite)) throw new AppError(409, 'INVITATION_EXISTS', 'Já existem convites válidos. Confirme explicitamente a substituição dos links antes de gerar outros.');
    const links = [];
    for (const target of eligible) links.push({ accountId: target.id, name: target.name, email: target.email, ...await issueManualInvitation(c, actor, target.id, publicOrigin) });
    await audit(c, { actorId: actor.id, actorRole: actor.roles.includes('OWNER') ? 'OWNER' : 'ADMIN', action: 'IMPORT_INVITATIONS_ISSUED', targetId: requestId,
      details: { batchId, accountIds: eligible.map(t => t.id), replaceExisting, skipped: targets.length - eligible.length } });
    return { links, skipped: targets.length - eligible.length };
    });
  });
}
