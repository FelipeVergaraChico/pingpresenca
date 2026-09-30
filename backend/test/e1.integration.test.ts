import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { digest } from '../src/identity/password.js';
import { parseConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { initializeInstallation } from '../src/installation.js';
import { buildApp } from '../src/app.js';

if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.startsWith('/pingpresenca_test_')
)
  throw new Error('Exige banco isolado pingpresenca_test_*');
const config = parseConfig(process.env),
  password = 'synthetic-password-123456';
test('E1 integration: preparation, invitations, scope and integrity in real PostgreSQL', async (t) => {
  const pool = createPool(config),
    app = await buildApp(config, pool),
    second = await buildApp(config, pool);
  let n = 1;
  const post = (url: string, body: object, cookie = '', other = app) =>
    other.inject({
      method: 'POST',
      url,
      payload: body,
      headers: { origin: config.publicOrigin, cookie },
      remoteAddress: `10.0.${Math.floor(n / 250)}.${(n++ % 250) + 1}`,
    });
  const get = (url: string, cookie: string) => app.inject({ url, headers: { cookie } });
  async function okPost(url: string, body: object, cookie = '') {
    const r = await post(url, body, cookie);
    assert.ok(r.statusCode < 300, `${url}: ${r.statusCode} ${r.body}`);
    return r.json();
  }
  async function signIn(email: string) {
    const r = await post('/api/auth/login', { email, password });
    assert.equal(r.statusCode, 200, r.body);
    return String(r.headers['set-cookie']).split(';')[0]!;
  }
  let owner = '',
    admin = '',
    teacher = '',
    student = '',
    ownerId = '',
    teacherId = '',
    studentId = '',
    adminId = '',
    disciplineId = '',
    locationId = '',
    offeringId = '',
    otherId = '',
    lessonId = '';
  async function make(name: string, roles: string[], actor = owner) {
    return (
      await okPost(
        '/api/admin/accounts',
        { name, email: `${name}@example.com`, institutionalId: null, roles },
        actor,
      )
    ).id as string;
  }
  async function invite(id: string, actor = owner) {
    return (
      await okPost(`/admin/accounts/${id}/invitations`.replace('/admin/', '/api/admin/'), {}, actor)
    ).url.split('#invite=')[1] as string;
  }
  async function activate(id: string, email: string) {
    const token = await invite(id);
    await okPost('/api/invitations/accept', { token, password });
    return signIn(email);
  }
  const lessonBody = () => ({
    offeringId,
    locationId,
    title: 'Aula de programação',
    description: 'Introdução',
    startsLocal: '2026-09-10T19:00',
    endsLocal: '2026-09-10T21:00',
    attendanceMode: 'PILOT',
  });
  try {
    await migrate(pool);
    await pool.query(
      'TRUNCATE installation,accounts,disciplines,locations,offerings,lessons,audit_events CASCADE',
    );
    await initializeInstallation(pool, config);
    ownerId = (
      await okPost('/api/bootstrap', {
        name: 'Owner teste',
        email: 'owner-e1@example.com',
        password,
        secret: config.bootstrapSecret,
      })
    ).id;
    owner = await signIn('owner-e1@example.com');
    await t.test(
      'E1/A83: field validation is actionable, private and leaves no partial account',
      async () => {
        const before = (await pool.query('SELECT count(*) FROM accounts')).rows[0].count;
        const invalid = await post(
          '/api/admin/accounts',
          {
            name: ' ',
            email: 'private-invalid-email',
            roles: [],
            institutionalId: null,
          },
          owner,
        );
        assert.equal(invalid.statusCode, 400);
        assert.deepEqual(
          invalid.json().fieldErrors.map((e: { field: string }) => e.field),
          ['name', 'email', 'roles'],
        );
        assert.match(invalid.json().fieldErrors[0].message, /2 caracteres/);
        assert.equal(invalid.body.includes('private-invalid-email'), false);
        assert.equal((await pool.query('SELECT count(*) FROM accounts')).rows[0].count, before);
        const extra = await post(
          '/api/admin/accounts',
          {
            name: 'Conta válida',
            email: 'valid@example.com',
            roles: ['STUDENT'],
            institutionalId: null,
            'unknown-private-field': 'private-value',
          },
          owner,
        );
        assert.equal(extra.statusCode, 400);
        assert.deepEqual(extra.json().fieldErrors, []);
        assert.equal(extra.body.includes('unknown-private-field'), false);
        assert.equal(extra.body.includes('private-value'), false);
        const passwordError = await post('/api/invitations/accept', {
          token: 'a'.repeat(43),
          password: 'short',
        });
        assert.equal(passwordError.statusCode, 400);
        assert.match(passwordError.json().fieldErrors[0].message, /12 caracteres/);
        assert.equal(passwordError.body.includes('short'), false);
        const duplicate = await post(
          '/api/admin/accounts',
          {
            name: 'Duplicada',
            email: 'owner-e1@example.com',
            roles: ['STUDENT'],
            institutionalId: null,
          },
          owner,
        );
        assert.equal(duplicate.statusCode, 409);
        assert.equal(duplicate.json().fieldErrors[0].field, 'email');
        assert.equal(duplicate.body.includes('account_profiles'), false);
      },
    );
    await t.test('A05/A06: optional/required institutional identifier and hierarchy', async () => {
      teacherId = await make('professor', ['PROFESSOR']);
      studentId = await make('aluno', ['STUDENT']);
      adminId = await make('administrador', ['ADMIN', 'PROFESSOR']);
      admin = await activate(adminId, 'administrador@example.com');
      assert.equal(
        (
          await post(
            '/api/admin/accounts',
            {
              name: 'Intruso',
              email: 'intruso@example.com',
              institutionalId: null,
              roles: ['OWNER'],
            },
            owner,
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await post(
            '/api/admin/accounts',
            {
              name: 'Admin intruso',
              email: 'intruso@example.com',
              institutionalId: null,
              roles: ['ADMIN'],
            },
            admin,
          )
        ).statusCode,
        403,
      );
      await okPost(
        '/api/admin/settings',
        { institutionalIdRequired: true, version: 1, reason: 'Política da instituição' },
        owner,
      );
      const missingIdentifier = await post(
        '/api/admin/accounts',
        {
          name: 'Identificador ausente',
          email: 'identifier-test@example.com',
          institutionalId: null,
          roles: ['STUDENT'],
        },
        admin,
      );
      assert.equal(missingIdentifier.statusCode, 400);
      assert.equal(missingIdentifier.json().fieldErrors[0].field, 'institutionalId');
      assert.equal(
        (
          await post(
            '/api/admin/accounts',
            {
              name: 'Sem código',
              email: 'pessoal@gmail.com',
              institutionalId: null,
              roles: ['STUDENT'],
            },
            admin,
          )
        ).statusCode,
        400,
      );
      const account = await okPost(
        '/api/admin/accounts',
        {
          name: 'Com código',
          email: 'pessoal@gmail.com',
          institutionalId: 'MAT-123',
          roles: ['STUDENT'],
        },
        admin,
      );
      assert.ok(account.id);
      await okPost(
        '/api/admin/settings',
        { institutionalIdRequired: false, version: 2, reason: 'Voltar ao opcional' },
        owner,
      );
      for (const targetId of [ownerId, adminId]) {
        const target = (await get('/api/admin/accounts', owner))
          .json()
          .find((a: { id: string }) => a.id === targetId);
        assert.equal(
          (
            await post(
              `/api/admin/accounts/${targetId}/profile`,
              {
                name: 'Modificado',
                institutionalId: null,
                version: target.version,
                reason: 'Teste proibido',
              },
              admin,
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await post(
              `/api/admin/accounts/${targetId}/roles`,
              { roles: ['PROFESSOR'], version: target.version, reason: 'Teste proibido' },
              admin,
            )
          ).statusCode,
          403,
        );
      }
    });
    await t.test(
      'A07/A08/A09/A10: manual invite lifecycle, tampering, expiry and race',
      async () => {
        assert.equal(
          (await post('/api/auth/login', { email: 'aluno@example.com', password })).statusCode,
          401,
        );
        const old = await invite(studentId);
        const current = await invite(studentId);
        assert.equal(
          (await post('/api/invitations/accept', { token: old, password })).statusCode,
          410,
        );
        assert.equal(
          (
            await post('/api/invitations/accept', {
              token: current,
              password,
              roles: ['ADMIN'],
              offeringId: randomUUID(),
            })
          ).statusCode,
          400,
        );
        const race = await Promise.all([
          post('/api/invitations/accept', { token: current, password }),
          post('/api/invitations/accept', { token: current, password }, '', second),
        ]);
        assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 410]);
        assert.equal(
          (
            await pool.query('SELECT email_verified_at FROM account_profiles WHERE account_id=$1', [
              studentId,
            ])
          ).rows[0].email_verified_at,
          null,
        );
        assert.equal(
          (await post('/api/invitations/accept', { token: current, password })).statusCode,
          410,
        );
        assert.equal(
          (await post(`/api/admin/accounts/${studentId}/invitations`, {}, owner)).statusCode,
          409,
        );
        const expiredId = await make('expirado', ['STUDENT']);
        const expired = await invite(expiredId);
        await pool.query(
          'UPDATE invitations SET expires_at=clock_timestamp() WHERE account_id=$1',
          [expiredId],
        );
        assert.equal(
          (await post('/api/invitations/accept', { token: expired, password })).statusCode,
          410,
        );
        const all = JSON.stringify((await pool.query('SELECT * FROM audit_events')).rows);
        for (const secret of [old, current, expired, password])
          assert.equal(all.includes(secret), false);
        student = await signIn('aluno@example.com');
        teacher = await activate(teacherId, 'professor@example.com');
        assert.equal(
          (await post('/api/invitations/inspect', { token: current, channel: 'EMAIL' })).statusCode,
          400,
        );
        assert.equal(
          (await post('/api/auth/recover', { email: 'aluno@example.com' })).statusCode,
          404,
        );
      },
    );
    await t.test('A03/A18: one discipline, two offerings, scoped faculty permissions', async () => {
      disciplineId = (
        await okPost('/api/disciplines', { name: 'Programação I', description: '' }, admin)
      ).id;
      locationId = (
        await okPost(
          '/api/locations',
          { name: 'Sala 201', latitude: -23.5, longitude: -46.6, radius: 100, geoRequired: true },
          admin,
        )
      ).id;
      offeringId = (
        await okPost(
          '/api/offerings',
          {
            disciplineId,
            name: 'Programação I Noite',
            term: '2026/2',
            shift: 'Noite',
            attendanceMode: 'PILOT',
          },
          admin,
        )
      ).id;
      otherId = (
        await okPost(
          '/api/offerings',
          {
            disciplineId,
            name: 'Programação I Manhã',
            term: '2026/2',
            shift: 'Manhã',
            attendanceMode: 'OFFICIAL',
          },
          admin,
        )
      ).id;
      await okPost(
        `/api/offerings/${offeringId}/teachers`,
        { teacherIds: [teacherId], version: 1 },
        admin,
      );
      for (const [url, body] of [
        ['/api/disciplines', { name: 'Inválida' }],
        [
          '/api/offerings',
          {
            disciplineId,
            name: 'Intrusa',
            term: '2026/2',
            shift: 'Noite',
            attendanceMode: 'PILOT',
          },
        ],
        [`/api/offerings/${otherId}/teachers`, { teacherIds: [teacherId], version: 1 }],
        [
          `/api/offerings/${offeringId}/enrollments`,
          { accountId: studentId, enrolledLocal: '2026-09-01T00:00', endedLocal: null },
        ],
      ] as [string, object][]) {
        assert.equal((await post(url, body, teacher)).statusCode, 403);
      }
      assert.equal((await get(`/api/offerings/${otherId}/members`, teacher)).statusCode, 404);
      assert.deepEqual(
        (await get('/api/offerings', teacher)).json().map((o: { id: string }) => o.id),
        [offeringId],
      );
      assert.equal(
        (await post('/api/lessons', { ...lessonBody(), offeringId: otherId }, teacher)).statusCode,
        404,
      );
      assert.equal((await get('/api/admin/accounts', teacher)).statusCode, 403);
      assert.equal((await get('/api/catalog', student)).statusCode, 403);
    });
    await t.test(
      'A19/A20/A22: eligibility boundaries and concurrent enrollment exclusion',
      async () => {
        const enrollment = await okPost(
          `/api/offerings/${offeringId}/enrollments`,
          { accountId: studentId, enrolledLocal: '2026-09-10T19:00', endedLocal: null },
          admin,
        );
        lessonId = (await okPost('/api/lessons', lessonBody(), teacher)).id;
        const late = await make('atrasado', ['STUDENT']),
          ended = await make('encerrado', ['STUDENT']),
          during = await make('durante', ['STUDENT']);
        await okPost(
          `/api/offerings/${offeringId}/enrollments`,
          { accountId: late, enrolledLocal: '2026-09-10T19:01', endedLocal: null },
          admin,
        );
        await okPost(
          `/api/offerings/${offeringId}/enrollments`,
          { accountId: ended, enrolledLocal: '2026-09-01T00:00', endedLocal: '2026-09-10T19:00' },
          admin,
        );
        await okPost(
          `/api/offerings/${offeringId}/enrollments`,
          { accountId: during, enrolledLocal: '2026-09-01T00:00', endedLocal: '2026-09-10T19:01' },
          admin,
        );
        const plan = (await get(`/api/lessons/${lessonId}/planning`, teacher)).json();
        assert.deepEqual(
          plan.students.map((s: { account_id: string }) => s.account_id).sort(),
          [studentId, during].sort(),
        );
        assert.equal(plan.lesson.starts_at, '2026-09-10T22:00:00.000Z');
        assert.equal((await get(`/api/offerings/${offeringId}/lessons`, student)).json().items.length, 1);
        assert.equal((await get(`/api/offerings/${offeringId}/members`, student)).statusCode, 404);
        assert.equal((await get(`/api/lessons/${lessonId}/planning`, student)).statusCode, 404);
        await okPost(
          `/api/enrollments/${enrollment.id}/end`,
          { endedLocal: '2026-09-10T20:00', version: 1 },
          admin,
        );
        const next = { accountId: studentId, enrolledLocal: '2026-09-10T20:00', endedLocal: null };
        const race = await Promise.all([
          post(`/api/offerings/${offeringId}/enrollments`, next, admin),
          post(`/api/offerings/${offeringId}/enrollments`, next, admin, second),
        ]);
        assert.deepEqual(race.map((r) => r.statusCode).sort(), [201, 409]);
        await assert.rejects(
          pool.query(
            'INSERT INTO enrollments(id,offering_id,account_id,enrolled_at) VALUES ($1,$2,$3,$4)',
            [randomUUID(), offeringId, studentId, '2026-09-10T23:00:00Z'],
          ),
          { code: '23P01' },
        );
      },
    );
    await t.test(
      'A28/A31: authorized location changes, policy copy, modes and stale versions',
      async () => {
        const original = (await get(`/api/lessons/${lessonId}/planning`, teacher)).json();
        assert.equal(original.policyPreview.precisionRule, 'CONSERVATIVE_V1');
        assert.equal(original.previewOnly, true);
        assert.equal(
          (
            await post(
              '/api/locations',
              { name: 'Falsa', latitude: 0, longitude: 0, radius: 100, geoRequired: false },
              teacher,
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await post(
              `/api/lessons/${lessonId}`,
              { ...lessonBody(), version: 1, geoRequired: false },
              teacher,
            )
          ).statusCode,
          400,
        );
        assert.equal(
          (await post('/api/lessons', { ...lessonBody(), locationId: randomUUID() }, teacher))
            .statusCode,
          404,
        );
        const otherLocation = (
          await okPost(
            '/api/locations',
            { name: 'Sala 202', latitude: -23, longitude: -46, radius: 200, geoRequired: true },
            admin,
          )
        ).id;
        await okPost(
          `/api/lessons/${lessonId}`,
          { ...lessonBody(), locationId: otherLocation, version: 1 },
          teacher,
        );
        assert.equal(
          (await post(`/api/lessons/${lessonId}`, { ...lessonBody(), version: 1 }, teacher))
            .statusCode,
          409,
        );
        await okPost(
          `/api/locations/${locationId}`,
          {
            name: 'Sala 201 alterada',
            latitude: 0,
            longitude: 0,
            radius: 900,
            geoRequired: false,
            version: 1,
          },
          admin,
        );
        assert.equal(original.policyPreview.radius, 100);
        assert.equal(original.policyPreview.geoRequired, true);
        await okPost(
          `/api/offerings/${offeringId}`,
          {
            name: 'Programação I Noite',
            term: '2026/2',
            shift: 'Noite',
            attendanceMode: 'OFFICIAL',
            version: 2,
          },
          admin,
        );
        assert.equal(
          (await get(`/api/offerings/${offeringId}/lessons`, teacher)).json().items[0].attendance_mode,
          'PILOT',
        );
        // Synthetic lock markers exercise foundations; no attendance endpoint exists.
        await pool.query(
          'UPDATE lessons SET context_locked_at=clock_timestamp(),mode_locked_at=clock_timestamp() WHERE id=$1',
          [lessonId],
        );
        assert.equal(
          (
            await post(
              `/api/lessons/${lessonId}`,
              {
                ...lessonBody(),
                locationId: otherLocation,
                startsLocal: '2026-09-10T19:01',
                version: 2,
              },
              teacher,
            )
          ).statusCode,
          409,
        );
        assert.equal(
          (
            await post(
              `/api/lessons/${lessonId}`,
              {
                ...lessonBody(),
                locationId: otherLocation,
                attendanceMode: 'OFFICIAL',
                version: 2,
              },
              teacher,
            )
          ).statusCode,
          409,
        );
        const retro = await make('retroativo', ['STUDENT']);
        assert.equal(
          (
            await post(
              `/api/offerings/${offeringId}/enrollments`,
              { accountId: retro, enrolledLocal: '2026-09-01T00:00', endedLocal: null },
              admin,
            )
          ).statusCode,
          409,
        );
      },
    );
    await t.test(
      'E1/A83: temporal domain errors identify the field without persisting a lesson',
      async () => {
        const before = (await pool.query('SELECT count(*) FROM lessons')).rows[0].count;
        const invalidEnd = await post(
          '/api/lessons',
          { ...lessonBody(), endsLocal: '2026-09-10T18:00' },
          teacher,
        );
        assert.equal(invalidEnd.statusCode, 400);
        assert.equal(invalidEnd.json().fieldErrors[0].field, 'endsLocal');
        const invalidStart = await post(
          '/api/lessons',
          { ...lessonBody(), startsLocal: 'not-a-date' },
          teacher,
        );
        assert.equal(invalidStart.statusCode, 400);
        assert.equal(invalidStart.json().fieldErrors[0].field, 'startsLocal');
        const invalidEnrollment = await post(
          `/api/offerings/${offeringId}/enrollments`,
          {
            accountId: studentId,
            enrolledLocal: '2026-09-10T19:00',
            endedLocal: '2026-09-10T18:00',
          },
          admin,
        );
        assert.equal(invalidEnrollment.statusCode, 400);
        assert.equal(invalidEnrollment.json().fieldErrors[0].field, 'endedLocal');
        assert.equal((await pool.query('SELECT count(*) FROM lessons')).rows[0].count, before);
      },
    );
    await t.test('A05/A07: role changes revoke old invites and recheck authority', async () => {
      const id = await make('promovido', ['PROFESSOR'], admin),
        old = await invite(id, admin);
      await okPost(
        `/api/admin/accounts/${id}/roles`,
        { roles: ['ADMIN', 'PROFESSOR'], version: 1, reason: 'Apoio administrativo' },
        owner,
      );
      assert.equal(
        (await post('/api/invitations/accept', { token: old, password })).statusCode,
        410,
      );
      assert.equal(
        (await post(`/api/admin/accounts/${id}/invitations`, {}, admin)).statusCode,
        403,
      );
      const row = (await get('/api/admin/accounts', owner))
        .json()
        .find((a: { id: string }) => a.id === adminId);
      await okPost(
        `/api/admin/accounts/${adminId}/roles`,
        { roles: ['PROFESSOR'], version: row.version, reason: 'Fim da atribuição' },
        owner,
      );
      assert.equal((await get('/api/admin/accounts', admin)).statusCode, 403);
      assert.equal((await get('/api/admin/accounts', owner)).statusCode, 200);
      const ownerRow = (await get('/api/admin/accounts', owner))
        .json()
        .find((a: { id: string }) => a.id === ownerId);
      await okPost(
        `/api/admin/accounts/${ownerId}/roles`,
        { roles: ['PROFESSOR'], version: ownerRow.version, reason: 'Owner também docente' },
        owner,
      );
      assert.equal(
        (await pool.query("SELECT count(*) FROM account_roles WHERE role='OWNER'")).rows[0].count,
        '1',
      );
    });
    await t.test('E1 audit rollback and no invented attendance endpoints', async () => {
      await pool.query(
        `CREATE FUNCTION test_fail_e1() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END; $$; CREATE TRIGGER test_fail_e1 BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_fail_e1()`,
      );
      try {
        const before = (await pool.query('SELECT count(*) FROM disciplines')).rows[0].count;
        assert.equal(
          (await post('/api/disciplines', { name: 'Não deve persistir' }, owner)).statusCode,
          500,
        );
        assert.equal((await pool.query('SELECT count(*) FROM disciplines')).rows[0].count, before);
      } finally {
        await pool.query('DROP TRIGGER test_fail_e1 ON audit_events; DROP FUNCTION test_fail_e1()');
      }
      assert.equal((await post(`/api/lessons/${lessonId}/open`, {}, owner)).statusCode, 404);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM audit_events WHERE action='INVITATION_ACCEPTED' AND target_id=$1",
            [studentId],
          )
        ).rows[0].count,
        '1',
      );
    });
    await t.test(
      'E0 to E1 migration preserves existing owner, password, session and audit',
      async () => {
        const dbName = `pingpresenca_test_upgrade_${randomUUID().replaceAll('-', '')}`;
        await pool.query(`CREATE DATABASE ${dbName}`);
        const url = new URL(process.env.DATABASE_URL!);
        url.pathname = `/${dbName}`;
        const upgradeConfig = parseConfig({ ...process.env, DATABASE_URL: url.toString() });
        const upgradePool = createPool(upgradeConfig),
          upgradeApp = await buildApp(upgradeConfig, upgradePool);
        try {
          const sql = await readFile(
            new URL('../migrations/001_foundation.sql', import.meta.url),
            'utf8',
          );
          await upgradePool.query(sql);
          await upgradePool.query(
            'CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())',
          );
          await upgradePool.query('INSERT INTO schema_migrations(name,checksum) VALUES ($1,$2)', [
            '001_foundation.sql',
            digest(sql),
          ]);
          await initializeInstallation(upgradePool, upgradeConfig);
          const created = await post(
            '/api/bootstrap',
            {
              name: 'Owner preservado',
              email: 'upgrade@example.com',
              password,
              secret: config.bootstrapSecret,
            },
            '',
            upgradeApp,
          );
          assert.equal(created.statusCode, 201);
          const signed = await post(
            '/api/auth/login',
            { email: 'upgrade@example.com', password },
            '',
            upgradeApp,
          );
          assert.equal(signed.statusCode, 200);
          const cookie = String(signed.headers['set-cookie']).split(';')[0]!;
          const before = (await upgradePool.query('SELECT password_hash FROM accounts')).rows[0]
            .password_hash;
          const events = (await upgradePool.query('SELECT count(*) FROM audit_events')).rows[0]
            .count;
          assert.deepEqual(await migrate(upgradePool), ['002_academic_preparation.sql','003_attendance.sql','004_pilot_integrity.sql']);
          assert.equal(
            (await upgradePool.query('SELECT password_hash FROM accounts')).rows[0].password_hash,
            before,
          );
          assert.equal(
            (await upgradePool.query('SELECT count(*) FROM audit_events')).rows[0].count,
            events,
          );
          assert.equal(
            (await upgradeApp.inject({ url: '/api/auth/me', headers: { cookie } })).json().id,
            created.json().id,
          );
          assert.equal(
            (await upgradeApp.inject({ url: '/api/admin/accounts', headers: { cookie } }))
              .statusCode,
            200,
          );
          assert.deepEqual(await migrate(upgradePool), []);
        } finally {
          await upgradeApp.close();
          await upgradePool.end();
          await pool.query(`DROP DATABASE ${dbName}`);
        }
      },
    );
  } finally {
    await app.close();
    await second.close();
    await pool.end();
  }
});
