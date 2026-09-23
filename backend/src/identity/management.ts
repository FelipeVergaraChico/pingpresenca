import { randomBytes, randomUUID } from 'node:crypto';
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
) {
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
      await c.query(
        'UPDATE invitations SET revoked_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',
        [accountId],
      );
      const secret = randomBytes(32).toString('base64url');
      const invitationId = randomUUID();
      const {
        rows: [invitation],
      } = await c.query(
        `INSERT INTO invitations(id,account_id,token_hash,channel,created_by,expires_at)
        VALUES ($1,$2,$3,'MANUAL',$4,clock_timestamp()+interval '48 hours') RETURNING expires_at`,
        [invitationId, accountId, digest(secret), p.id],
      );
      await audit(c, {
        actorId: p.id,
        actorRole: p.roles.includes('OWNER') ? 'OWNER' : 'ADMIN',
        action: 'INVITATION_ISSUED',
        targetId: accountId,
        details: { invitationId, channel: 'MANUAL', expiresAt: invitation.expires_at },
      });
      return {
        url: `${config.publicOrigin}/#invite=${secret}`,
        expiresAt: invitation.expires_at,
        channel: 'MANUAL',
      };
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
        // EMAIL is reserved for an actual delivery implementation, never accepted
        // from client input. Manual acceptance cannot prove ownership of an email.
        if (invitation.channel !== 'MANUAL')
          throw new AppError(409, 'CHANNEL_UNAVAILABLE', 'Canal ainda não disponível.');
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
        await c.query(
          'UPDATE invitations SET revoked_at=clock_timestamp() WHERE account_id=$1 AND id<>$2 AND consumed_at IS NULL AND revoked_at IS NULL',
          [invitation.account_id, invitation.id],
        );
        await audit(c, {
          actorId: invitation.account_id,
          actorRole: 'ACCOUNT',
          action: 'INVITATION_ACCEPTED',
          targetId: invitation.account_id,
          details: { invitationId: invitation.id, channel: 'MANUAL', emailVerified: false },
        });
        return { accepted: true };
      });
    },
  );
}
