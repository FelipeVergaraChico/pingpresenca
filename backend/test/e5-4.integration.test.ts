import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { initializeInstallation } from '../src/installation.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/identity/password.js';

test('E5.4: ciclo de contas e turmas em PostgreSQL isolado', async t => {
  if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.startsWith('/pingpresenca_test_')) throw new Error('Banco isolado obrigatório');
  const config = parseConfig(process.env), pool = createPool(config), app = await buildApp(config, pool);
  let address = 1;
  const post = (url: string, payload: object, cookie = '') => app.inject({ method: 'POST', url, payload, headers: { origin: config.publicOrigin, cookie }, remoteAddress: `198.51.100.${address++ % 250 + 1}` });
  const get = (url: string, cookie: string) => app.inject({ url, headers: { cookie } });
  const ok = async (url: string, payload: object, cookie = '') => {
    const r = await post(url, payload, cookie); assert(r.statusCode < 300, `${url}: ${r.statusCode} ${r.body}`); return r.json();
  };
  const password = 'synthetic-e54-password';
  try {
    await migrate(pool);
    await pool.query('TRUNCATE installation,accounts,disciplines,locations,offerings,lessons,audit_events CASCADE');
    await initializeInstallation(pool, config);
    const hash = await hashPassword(password);
    async function login(email: string) {
      const r = await post('/api/auth/login', { email, password });
      assert.equal(r.statusCode, 200, r.body); return String(r.headers['set-cookie']).split(';')[0]!;
    }
    async function account(role: string) {
      const id = randomUUID(), email = `${id}@example.test`;
      await pool.query('INSERT INTO accounts(id,password_hash) VALUES($1,$2)', [id, hash]);
      await pool.query('INSERT INTO account_profiles(account_id,name,email) VALUES($1,$2,$3)', [id, role, email]);
      await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [id, role]);
      return { id, email, cookie: await login(email) };
    }
    const owner = await account('OWNER'), admin = await account('ADMIN'), teacher = await account('PROFESSOR'), student = await account('STUDENT');
    const discipline = randomUUID(), offering = randomUUID(), location = randomUUID();
    await pool.query("INSERT INTO disciplines(id,name) VALUES($1,'E5.4')", [discipline]);
    await pool.query("INSERT INTO locations(id,name,latitude,longitude,radius,geo_required) VALUES($1,'Sala',-23,-46,100,false)", [location]);
    await pool.query("INSERT INTO offerings(id,discipline_id,name,term,shift,attendance_mode) VALUES($1,$2,'Turma E5.4','2026','Noite','PILOT')", [offering, discipline]);
    await pool.query('INSERT INTO offering_teachers(offering_id,account_id) VALUES($1,$2)', [offering, teacher.id]);
    await pool.query("INSERT INTO enrollments(id,offering_id,account_id,enrolled_at) VALUES($1,$2,$3,clock_timestamp()-interval '1 day')", [randomUUID(), offering, student.id]);
    const accountState = async (id: string) => (await get('/api/admin/accounts', owner.cookie)).json().find((a: any) => a.id === id);
    const offeringState = async () => (await get('/api/offerings', owner.cookie)).json().find((o: any) => o.id === offering);
    const accountChange = async (id: string, active: boolean) => {
      const a = await accountState(id); return { active, version: a.version, reason: 'Verificação administrativa', activeEnrollmentCount: a.active_enrollment_count };
    };
    const changeAccount = async (id: string, active: boolean, cookie = owner.cookie) => ok(`/api/admin/accounts/${id}/status`, await accountChange(id, active), cookie);
    const changeOffering = async (active: boolean) => ok(`/api/offerings/${offering}/status`, { active, version: (await offeringState()).version }, owner.cookie);
    async function lesson() {
      const id = randomUUID();
      await pool.query("INSERT INTO lessons(id,offering_id,location_id,title,starts_at,ends_at,attendance_mode) VALUES($1,$2,$3,'Aula',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','PILOT')", [id, offering, location]);
      return `/api/attendance/${id}`;
    }
    const view = async (p: string) => (await get(p, teacher.cookie)).json();
    const close = async (p: string) => ok(`${p}/close`, { openingId: (await view(p)).openingId }, teacher.cookie);
    const authorize = async (p: string) => {
      const projection = (await get(`${p}/projection`, teacher.cookie)).json();
      const qr = new URLSearchParams(new URL(projection.qrUrl).hash.slice(1)).get('challenge');
      return ok(`${p}/authorize`, { qr }, student.cookie);
    };
    await t.test('A05/A16: hierarquia, owner protegido, motivo e versão obrigatórios', async () => {
      for (const target of [owner, admin]) assert.equal((await post(`/api/admin/accounts/${target.id}/status`, await accountChange(target.id, false), admin.cookie)).statusCode, 403);
      assert.equal((await post(`/api/admin/accounts/${owner.id}/status`, await accountChange(owner.id, false), owner.cookie)).statusCode, 403);
      assert.equal((await post(`/api/admin/accounts/${student.id}/status`, await accountChange(student.id, false), teacher.cookie)).statusCode, 403);
      assert.equal((await post(`/api/admin/accounts/${student.id}/status`, { ...await accountChange(student.id, false), reason: '' }, owner.cookie)).statusCode, 400);
      assert.equal((await post(`/api/admin/accounts/${student.id}/status`, { ...await accountChange(student.id, false), activeEnrollmentCount: 0 }, owner.cookie)).statusCode, 409);
      await changeAccount(admin.id, false);
      assert.equal((await get('/api/admin/accounts', admin.cookie)).statusCode, 401);
      await changeAccount(admin.id, true); admin.cookie = await login(admin.email);
    });
    await t.test('A16/A17/A43: revoga acesso e autorização sem retirar matrícula; reativação não restaura links', async () => {
      const p = await lesson(); await ok(`${p}/open`, {}, teacher.cookie);
      const auth = await authorize(p), oldCookie = student.cookie;
      const recovery = await ok(`/api/admin/accounts/${student.id}/recovery`, { reason: 'Recuperação sintética' }, admin.cookie);
      const before = (await pool.query('SELECT * FROM enrollments WHERE account_id=$1', [student.id])).rows;
      const input = await accountChange(student.id, false);
      await ok(`/api/admin/accounts/${student.id}/status`, input, admin.cookie);
      assert.equal((await post(`/api/admin/accounts/${student.id}/status`, input, admin.cookie)).statusCode, 409);
      assert.equal((await post('/api/auth/login', { email: student.email, password })).statusCode, 401);
      assert.equal((await post(`${p}/confirm`, { token: auth.token, geo: { status: 'DENIED' } }, oldCookie)).statusCode, 401);
      assert.deepEqual((await pool.query('SELECT * FROM enrollments WHERE account_id=$1', [student.id])).rows, before);
      await changeAccount(student.id, true); student.cookie = await login(student.email);
      assert.equal((await get('/api/offerings', oldCookie)).statusCode, 401);
      assert.equal((await post('/api/recovery/inspect', { token: recovery.url.split('#recovery=')[1] })).statusCode, 410);
      assert.equal((await post(`${p}/confirm`, { token: auth.token, geo: { status: 'DENIED' } }, student.cookie)).statusCode, 409);
      await changeAccount(student.id, false); await close(p);
      assert.equal((await view(p)).records.find((r: any) => r.account_id === student.id).status, 'ABSENT');
      await changeAccount(student.id, true); student.cookie = await login(student.email);
      const events = (await pool.query("SELECT * FROM audit_events WHERE action='ACCOUNT_DEACTIVATED' AND target_id=$1 ORDER BY occurred_at", [student.id])).rows;
      assert.equal(events.length, 2); assert.equal(events[0].actor_id, admin.id);
      assert.equal(events[0].details.before.active, true); assert.equal(events[0].details.after.active, false);
      assert.equal(events[0].details.activeEnrollmentCount, 1);
    });
    await t.test('A16: convite revogado não revive e vínculos de professor desativado permanecem', async () => {
      const pending = await ok('/api/admin/accounts', { name: 'Convite pendente', email: 'pending@example.test', roles: ['STUDENT'], institutionalId: null }, owner.cookie);
      const invite = await ok(`/api/admin/accounts/${pending.id}/invitations`, {}, owner.cookie);
      await changeAccount(pending.id, false); await changeAccount(pending.id, true);
      assert.equal((await post('/api/invitations/inspect', { token: invite.url.split('#invite=')[1] })).statusCode, 410);
      await changeAccount(teacher.id, false);
      await ok(`/api/offerings/${offering}/teachers`, { version: (await offeringState()).version, teacherIds: [teacher.id] }, owner.cookie);
      assert.equal((await pool.query('SELECT count(*)::int n FROM offering_teachers WHERE account_id=$1', [teacher.id])).rows[0].n, 1);
      await changeAccount(teacher.id, true); teacher.cookie = await login(teacher.email);
    });
    await t.test('A29/A30: arquivar bloqueia atividade e preserva consultas/correções; reativar não restaura cancelamentos', async () => {
      const p = await lesson(); await ok(`${p}/open`, {}, teacher.cookie);
      const url = `/api/offerings/${offering}/status`;
      assert.equal((await post(url, { active: false, version: (await offeringState()).version }, owner.cookie)).json().code, 'OPEN_ATTENDANCE');
      await close(p);
      const cancelled = await lesson();
      await ok(`${cancelled}/cancel`, { version: (await view(cancelled)).lessonVersion, reason: 'Cancelamento sintético' }, teacher.cookie);
      const before = (await pool.query('SELECT * FROM enrollments WHERE offering_id=$1', [offering])).rows;
      const input = { active: false, version: (await offeringState()).version };
      assert.equal((await post(url, input, teacher.cookie)).statusCode, 403);
      await ok(url, input, admin.cookie);
      assert.equal((await post(url, input, admin.cookie)).statusCode, 409);
      const newLesson = { offeringId: offering, locationId: location, title: 'Não criar', description: '', startsLocal: '2030-01-01T19:00', endsLocal: '2030-01-01T20:00', attendanceMode: 'PILOT' };
      assert.equal((await post('/api/lessons', newLesson, teacher.cookie)).json().code, 'OFFERING_INACTIVE');
      assert.equal((await post(`/api/offerings/${offering}/enrollments`, { accountId: student.id, enrolledLocal: '2030-01-01T19:00', endedLocal: null }, owner.cookie)).json().code, 'OFFERING_INACTIVE');
      assert.equal((await post(`${p}/reopen`, { openingId: (await view(p)).openingId, reason: 'Não reabrir arquivada' }, teacher.cookie)).statusCode, 409);
      assert.equal((await post(`${await lesson()}/open`, {}, teacher.cookie)).statusCode, 409);
      const record = (await view(p)).records.find((r: any) => r.account_id === student.id);
      await ok(`${p}/decision`, { accountId: student.id, version: record.version, kind: 'CORRECTION', status: 'PRESENT', reason: 'Correção histórica' }, teacher.cookie);
      assert.equal((await get(`/api/attendance/history/${offering}`, student.cookie)).statusCode, 200);
      assert.deepEqual((await pool.query('SELECT * FROM enrollments WHERE offering_id=$1', [offering])).rows, before);
      await changeOffering(true);
      assert.equal((await view(cancelled)).state, 'CANCELLED');
      assert.deepEqual((await pool.query('SELECT * FROM enrollments WHERE offering_id=$1', [offering])).rows, before);
      const events = (await pool.query("SELECT * FROM audit_events WHERE action IN ('OFFERING_ARCHIVED','OFFERING_REACTIVATED') AND target_id=$1", [offering])).rows;
      assert.equal(events.length, 2); assert(events.every(e => e.details.reason === '' && e.actor_id));
    });
    await t.test('A22/A23/A24/A30: períodos separados, lacuna sem participação e histórico fixado', async () => {
      const s = await account('STUDENT');
      const enroll = (start: string, end: string | null) => ok(`/api/offerings/${offering}/enrollments`, { accountId: s.id, enrolledLocal: start, endedLocal: end }, owner.cookie);
      const first = await enroll('2020-01-01T00:00', '2020-02-01T00:00');
      const second = await enroll('2020-03-01T00:00', '2020-04-01T00:00');
      assert.notEqual(first.id, second.id);
      const ids: string[] = [];
      for (const starts of ['2020-01-15T19:00', '2020-02-15T19:00', '2020-03-15T19:00']) {
        ids.push((await ok('/api/lessons', { offeringId: offering, locationId: location, title: 'Histórico de períodos', description: '', startsLocal: starts, endsLocal: starts.replace('19:00', '20:00'), attendanceMode: 'PILOT' }, teacher.cookie)).id);
      }
      const history = (await get(`/api/attendance/history/${offering}`, s.cookie)).json().lessons;
      assert(history.some((l: any) => l.id === ids[0])); assert(!history.some((l: any) => l.id === ids[1])); assert(history.some((l: any) => l.id === ids[2]));
      await changeOffering(false); await changeOffering(true);
      const periods = (await pool.query('SELECT id,ended_at FROM enrollments WHERE account_id=$1', [s.id])).rows;
      assert.equal(periods.length, 2); assert(periods.every(p => p.ended_at !== null));
      const p = await lesson(); await ok(`${p}/open`, {}, teacher.cookie); await close(p);
      assert.equal((await post(`/api/offerings/${offering}/enrollments`, { accountId: s.id, enrolledLocal: '2020-05-01T00:00', endedLocal: null }, owner.cookie)).json().code, 'HISTORICAL_ENROLLMENT');
    });
    await t.test('A16/R19: mudanças concorrentes não duplicam evento; recuperação emitida por admin desativado não revive', async () => {
      const recovery = await ok(`/api/admin/accounts/${student.id}/recovery`, { reason: 'Identidade conferida' }, admin.cookie);
      const input = await accountChange(admin.id, false);
      const results = await Promise.all([post(`/api/admin/accounts/${admin.id}/status`, input, owner.cookie), post(`/api/admin/accounts/${admin.id}/status`, input, owner.cookie)]);
      assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
      await changeAccount(admin.id, true); admin.cookie = await login(admin.email);
      assert.equal((await post('/api/recovery/inspect', { token: recovery.url.split('#recovery=')[1] })).statusCode, 410);
    });
    await t.test('A29/A54/A55: concorrência abertura/arquivamento e rollback de auditoria', async () => {
      const p = await lesson();
      const [archived, opened] = await Promise.all([
        post(`/api/offerings/${offering}/status`, { active: false, version: (await offeringState()).version }, owner.cookie),
        post(`${p}/open`, {}, teacher.cookie),
      ]);
      assert.deepEqual([archived.statusCode, opened.statusCode].sort(), [200, 409]);
      if (opened.statusCode === 200) await close(p); else await changeOffering(true);
      await pool.query(`CREATE FUNCTION fail_e54_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.action IN ('ACCOUNT_DEACTIVATED','OFFERING_ARCHIVED') THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
      await pool.query('CREATE TRIGGER fail_e54 BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_e54_audit()');
      try {
        assert.equal((await post(`/api/admin/accounts/${student.id}/status`, await accountChange(student.id, false), owner.cookie)).statusCode, 500);
        assert.equal((await accountState(student.id)).active, true);
        assert.equal((await get('/api/offerings', student.cookie)).statusCode, 200);
        assert.equal((await post(`/api/offerings/${offering}/status`, { active: false, version: (await offeringState()).version }, owner.cookie)).statusCode, 500);
        assert.equal((await offeringState()).active, true);
      } finally { await pool.query('DROP TRIGGER fail_e54 ON audit_events; DROP FUNCTION fail_e54_audit()'); }
    });
  } finally { await app.close(); await pool.end(); }
});
