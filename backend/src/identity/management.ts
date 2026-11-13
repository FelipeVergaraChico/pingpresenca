import { randomUUID } from 'node:crypto';
import { issueManualInvitation, issueInvitation } from './invitations.js';
import { createMailSender, type MailSender } from './mail.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Principal } from './authorization.js';
import { digest, hashPassword } from './password.js';
import { transaction } from '../db/pool.js';
import { audit } from '../audit.js';
import { adminOnly, checkVersion, managed, notFound } from '../academic/access.js';
import { AppError } from '../platform/errors.js';

const id = z.uuid();
const name = z.string().trim().min(2).max(120);
const institutionalId = z.string().trim().min(1).max(80).nullable();
const roles = z
  .array(z.enum(['ADMIN', 'PROFESSOR', 'STUDENT']))
  .min(1)
  .max(3)
  .refine((v) => new Set(v).size === v.length);
const version = z.number().int().positive();
const reason = z.string().trim().min(3).max(1000);
const tokenSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

async function accountRow(c: pg.PoolClient, accountId: string) {
  const {
    rows: [row],
  } = await c.query(
    `SELECT a.id,a.version,a.active,a.password_hash IS NOT NULL AS accepted,
    ARRAY(SELECT role FROM account_roles WHERE account_id=a.id ORDER BY role) AS roles
    FROM accounts a WHERE a.id=$1`,
    [accountId],
  );
  if (!row) notFound();
  return row as {
    id: string;
    version: number;
    active: boolean;
    accepted: boolean;
    roles: string[];
  };
}
function manageTarget(p: Principal, target: { roles: string[] }) {
  adminOnly(p);
  if (!p.roles.includes('OWNER') && target.roles.some((r) => r === 'ADMIN' || r === 'OWNER')) {
    throw new AppError(
      403,
      'PRIVILEGED_ACCOUNT',
      'Somente o owner pode gerenciar contas administrativas.',
    );
  }
}
async function validateIdentifier(c: pg.PoolClient, value: string | null) {
  const {
    rows: [settings],
  } = await c.query('SELECT institutional_id_required FROM installation');
  if (settings.institutional_id_required && !value)
    throw new AppError(400, 'IDENTIFIER_REQUIRED', 'O identificador institucional é obrigatório.', [
      {
        field: 'institutionalId',
        message: 'Identificador institucional: preencha este campo, obrigatório nesta instalação.',
      },
    ]);
}
async function validInvitation(c: pg.Pool | pg.PoolClient, token: string) {
  const {
    rows: [row],
  } = await c.query(
    `SELECT i.id,i.account_id,p.name,p.email,i.channel FROM invitations i
    JOIN accounts a ON a.id=i.account_id JOIN account_profiles p ON p.account_id=a.id
    WHERE i.token_hash=$1 AND i.consumed_at IS NULL AND i.revoked_at IS NULL
    AND (i.channel='MANUAL' OR (i.delivered_at IS NOT NULL AND i.delivered_email=p.email))
    AND i.expires_at>clock_timestamp() AND a.active AND a.password_hash IS NULL`,
    [digest(token)],
  );
  if (!row)
    throw new AppError(
      410,
      'INVITATION_UNAVAILABLE',
      'Convite inválido, expirado, substituído ou já utilizado. Solicite outro à administração.',
    );
  return row;
}

export function registerIdentityManagement(
  app: FastifyInstance,
  pool: pg.Pool,
  config: Config,
  token: (r: FastifyRequest) => string | undefined,
  sendMail: MailSender = createMailSender(config),
) {
  app.get('/api/admin/mail-status', r => managed(pool, token(r), async (_c, p) => {
    adminOnly(p);
    return { enabled: !!config.smtp && !config.publicDemo };
  }));
  app.post('/api/admin/accounts/:id/email-invitations', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async r => {
    const accountId = id.parse((r.params as { id: string }).id);
    z.strictObject({}).parse(r.body);
    const pending = await managed(pool, token(r), async (c, p) => {
      const target = await accountRow(c, accountId);
      manageTarget(p, target);
      if (!config.smtp || config.publicDemo) throw new AppError(409, 'SMTP_UNAVAILABLE', 'Envio por e-mail não configurado. Gere um convite manual.');
      if (target.accepted || !target.active || target.roles.includes('OWNER'))
        throw new AppError(409, 'NOT_INVITABLE', 'A conta não pode receber convite. Para contas ativadas, use recuperação de acesso.');
      if ((await c.query("SELECT 1 FROM invitations WHERE account_id=$1 AND channel='EMAIL' AND created_at>clock_timestamp()-interval '1 minute' LIMIT 1", [accountId])).rowCount)
        throw new AppError(429, 'INVITATION_RATE_LIMIT', 'Aguarde um minuto antes de enviar outro convite por e-mail para esta conta.');
      const { rows: [profile] } = await c.query('SELECT email FROM account_profiles WHERE account_id=$1', [accountId]);
      return { ...(await issueInvitation(c, p, accountId, config.publicOrigin, 'EMAIL', profile.email)), email: profile.email as string };
    });
    try {
      await sendMail({ to: pending.email, url: pending.url, installationName: config.installationName });
      // SMTP has no database transaction. Recheck identity, privileges and replacement after I/O.
      return await managed(pool, token(r), async (c, p) => {
        const target = await accountRow(c, accountId);
        manageTarget(p, target);
        if (!target.active || target.accepted || target.roles.includes('OWNER')) throw new AppError(409, 'INVITATION_CHANGED', 'A conta mudou durante o envio. Revise antes de emitir outro convite.');
        const result = await c.query(`UPDATE invitations i SET delivered_at=clock_timestamp()
          FROM account_profiles p WHERE i.id=$1 AND p.account_id=i.account_id AND p.email=i.delivered_email
          AND i.revoked_at IS NULL AND i.consumed_at IS NULL AND i.expires_at>clock_timestamp() RETURNING i.id`, [pending.invitationId]);
        if (!result.rowCount) throw new AppError(409, 'INVITATION_CHANGED', 'O convite foi substituído ou os dados mudaram durante o envio. Use apenas o convite mais recente.');
        await audit(c, { actorId: p.id, actorRole: p.roles.includes('OWNER') ? 'OWNER' : 'ADMIN', action: 'INVITATION_EMAIL_SENT', targetId: accountId,
          details: { invitationId: pending.invitationId, channel: 'EMAIL' } });
        return { sent: true, channel: 'EMAIL', expiresAt: pending.expiresAt };
      });
    } catch (error) {
      await transaction(pool, async c => {
        await c.query('SELECT pg_advisory_xact_lock(720261002)');
        await c.query('UPDATE invitations SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1 AND consumed_at IS NULL', [pending.invitationId]);
        await c.query(`INSERT INTO audit_events(id,actor_kind,actor_role,action,target_id,details)
          VALUES($1,'SYSTEM','SYSTEM','INVITATION_EMAIL_FAILED',$2,$3)`,
          [randomUUID(), accountId, { invitationId: pending.invitationId, channel: 'EMAIL' }]);
      });
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'SMTP_SEND_FAILED', 'Não foi possível confirmar o envio. Emita outro convite ou use o canal manual.');
    }
  });
  app.get('/api/admin/accounts', (r) =>
    managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      return (
        await c.query(`SELECT a.id,a.version,a.active,a.password_hash IS NOT NULL AS accepted,
      p.name,p.email,p.institutional_id,p.email_verified_at,
      ARRAY(SELECT role FROM account_roles WHERE account_id=a.id ORDER BY role) AS roles
      FROM accounts a JOIN account_profiles p ON p.account_id=a.id ORDER BY p.name,a.id`)
      ).rows;
    }),
  );
  app.get('/api/admin/settings', (r) =>
    managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      return (
        await c.query(
          'SELECT institutional_id_required, settings_version AS version FROM installation',
        )
      ).rows[0];
    }),
  );
  app.post('/api/admin/settings', async (r) => {
    const input = z
      .strictObject({ institutionalIdRequired: z.boolean(), version, reason })
      .parse(r.body);
    return managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      const before = (
        await c.query('SELECT institutional_id_required, settings_version FROM installation')
      ).rows[0];
      checkVersion(before.settings_version, input.version);
      await c.query(
        'UPDATE installation SET institutional_id_required=$1,settings_version=settings_version+1',
        [input.institutionalIdRequired],
      );
      await audit(c, {
        actorId: p.id,
        actorRole: p.roles.includes('OWNER') ? 'OWNER' : 'ADMIN',
        action: 'IDENTIFIER_POLICY_CHANGED',
        targetId: p.id,
        details: {
          before: before.institutional_id_required,
          after: input.institutionalIdRequired,
          reason: input.reason,
        },
      });
      return { updated: true };
    });
  });
  app.post('/api/admin/accounts', async (r, reply) => {
    const input = z
      .strictObject({
        name,
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
        institutionalId,
        roles,
      })
      .parse(r.body);
    const result = await managed(pool, token(r), async (c, p) => {
      adminOnly(p);
      if (input.roles.includes('ADMIN') && !p.roles.includes('OWNER'))
        throw new AppError(403, 'OWNER_REQUIRED', 'Somente o owner concede ADMIN.');
      await validateIdentifier(c, input.institutionalId);
      const accountId = randomUUID();
      await c.query('INSERT INTO accounts(id,password_hash) VALUES ($1,NULL)', [accountId]);
      await c.query(
        'INSERT INTO account_profiles(account_id,name,email,institutional_id) VALUES ($1,$2,$3,$4)',
        [accountId, input.name, input.email, input.institutionalId],
      );
      for (const role of input.roles)
        await c.query('INSERT INTO account_roles(account_id,role) VALUES ($1,$2)', [
          accountId,
          role,
        ]);
      await audit(c, {
        actorId: p.id,
        actorRole: p.roles.includes('OWNER') ? 'OWNER' : 'ADMIN',
        action: 'ACCOUNT_CREATED',
        targetId: accountId,
        details: {
          after: { roles: input.roles, invited: false, identifierPresent: !!input.institutionalId },
        },
      });
      return { id: accountId };
    });
    return reply.code(201).send(result);
  });
  app.post('/api/admin/accounts/:id/profile', async (r) => {
    const accountId = id.parse((r.params as { id: string }).id);
    const input = z.strictObject({ name, institutionalId, version, reason }).parse(r.body);
    return managed(pool, token(r), async (c, p) => {
      const target = await accountRow(c, accountId);
      manageTarget(p, target);
      checkVersion(target.version, input.version);
      await validateIdentifier(c, input.institutionalId);
      await c.query('UPDATE account_profiles SET name=$2,institutional_id=$3 WHERE account_id=$1', [
        accountId,
        input.name,
        input.institutionalId,
      ]);
      await c.query('UPDATE accounts SET version=version+1 WHERE id=$1', [accountId]);
      await audit(c, {
        actorId: p.id,
        actorRole: p.roles.includes('OWNER') ? 'OWNER' : 'ADMIN',
        action: 'ACCOUNT_PROFILE_UPDATED',
        targetId: accountId,
        details: {
          fields: ['name', 'institutionalId'],
          reason: input.reason,
          beforeVersion: target.version,
          afterVersion: target.version + 1,
        },
      });
      return { updated: true };
    });
  });
  app.post('/api/admin/accounts/:id/roles', async (r) => {
    const accountId = id.parse((r.params as { id: string }).id);
    const input = z
      .strictObject({
        roles: z
          .array(z.enum(['ADMIN', 'PROFESSOR', 'STUDENT']))
          .max(3)
          .refine((v) => new Set(v).size === v.length),
        version,
        reason,
      })
      .parse(r.body);
    return managed(pool, token(r), async (c, p) => {
      const target = await accountRow(c, accountId);
      manageTarget(p, target);
      checkVersion(target.version, input.version);
      if (!target.roles.includes('OWNER') && !input.roles.length)
        throw new AppError(400, 'ROLE_REQUIRED', 'A conta precisa de pelo menos um papel.');
      if (input.roles.includes('ADMIN') && !p.roles.includes('OWNER'))
        throw new AppError(403, 'OWNER_REQUIRED', 'Somente o owner concede ADMIN.');
      if (target.roles.includes('OWNER') && input.roles.includes('ADMIN'))
        throw new AppError(400, 'OWNER_ROLE_FIXED', 'OWNER já possui privilégios administrativos.');
      if (
        !input.roles.includes('PROFESSOR') &&
        (await c.query('SELECT 1 FROM offering_teachers WHERE account_id=$1 LIMIT 1', [accountId]))
          .rowCount
      ) {
        throw new AppError(
          409,
          'TEACHING_LINKS_EXIST',
          'Remova os vínculos docentes antes de retirar o papel PROFESSOR.',
        );
      }
      if (
        !input.roles.includes('STUDENT') &&
        (
          await c.query(
            'SELECT 1 FROM enrollments WHERE account_id=$1 AND (ended_at IS NULL OR ended_at>clock_timestamp()) LIMIT 1',
            [accountId],
          )
        ).rowCount
      ) {
        throw new AppError(
          409,
          'ENROLLMENTS_EXIST',
          'Encerre as matrículas vigentes ou futuras antes de retirar o papel STUDENT.',
        );
      }
      await c.query("DELETE FROM account_roles WHERE account_id=$1 AND role<>'OWNER'", [accountId]);
      await c.query('UPDATE password_recoveries SET revoked_at=clock_timestamp() WHERE (account_id=$1 OR initiated_by=$1) AND consumed_at IS NULL AND revoked_at IS NULL', [accountId]);
      for (const role of input.roles)
        await c.query('INSERT INTO account_roles(account_id,role) VALUES ($1,$2)', [
          accountId,
          role,
        ]);
      await c.query('UPDATE accounts SET version=version+1 WHERE id=$1', [accountId]);
      await c.query(
        'UPDATE invitations SET revoked_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',
        [accountId],
      );
      await audit(c, {
        actorId: p.id,
        actorRole: p.roles.includes('OWNER') ? 'OWNER' : 'ADMIN',
        action: 'ACCOUNT_ROLES_CHANGED',
        targetId: accountId,
        details: {
          before: target.roles,
          after: target.roles.includes('OWNER') ? ['OWNER', ...input.roles] : input.roles,
          reason: input.reason,
        },
      });
      return { updated: true };
    });
  });
  app.post('/api/admin/accounts/:id/invitations', async (r) => {
    const accountId = id.parse((r.params as { id: string }).id);
    z.strictObject({}).parse(r.body);
    return managed(pool, token(r), async (c, p) => {
      const target = await accountRow(c, accountId);
      manageTarget(p, target);
      if (target.accepted || !target.active || target.roles.includes('OWNER'))
        throw new AppError(
          409,
          'NOT_INVITABLE',
          'Convites são apenas para contas ainda não ativadas. Não substituem recuperação de senha.',
        );
      return issueManualInvitation(c, p, accountId, config.publicOrigin);
    });
  });
  app.post(
    '/api/invitations/inspect',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (r) => {
      const input = tokenSchema.parse(r.body);
      const invitation = await validInvitation(pool, input.token);
      return { name: invitation.name, email: invitation.email, channel: invitation.channel };
    },
  );
  app.post(
    '/api/invitations/accept',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (r) => {
      const input = tokenSchema.extend({ password: z.string().min(12).max(128) }).parse(r.body);
      await validInvitation(pool, input.token);
      const hash = await hashPassword(input.password);
      return transaction(pool, async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(720261002)');
        const invitation = await validInvitation(c, input.token);
        const consumed = await c.query(
          `UPDATE invitations SET consumed_at=clock_timestamp() WHERE id=$1
        AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() RETURNING id`,
          [invitation.id],
        );
        if (!consumed.rowCount)
          throw new AppError(
            410,
            'INVITATION_UNAVAILABLE',
            'O convite expirou. Solicite outro à administração.',
          );
        await c.query('UPDATE accounts SET password_hash=$2,version=version+1 WHERE id=$1', [
          invitation.account_id,
          hash,
        ]);
        if (invitation.channel === 'EMAIL') await c.query(
          'UPDATE account_profiles SET email_verified_at=clock_timestamp() WHERE account_id=$1 AND email=$2',
          [invitation.account_id, invitation.email],
        );
        await c.query(
          'UPDATE invitations SET revoked_at=clock_timestamp() WHERE account_id=$1 AND id<>$2 AND consumed_at IS NULL AND revoked_at IS NULL',
          [invitation.account_id, invitation.id],
        );
        await audit(c, {
          actorId: invitation.account_id,
          actorRole: 'ACCOUNT',
          action: 'INVITATION_ACCEPTED',
          targetId: invitation.account_id,
          details: { invitationId: invitation.id, channel: invitation.channel, emailVerified: invitation.channel === 'EMAIL' },
        });
        return { accepted: true };
      });
    },
  );
}
