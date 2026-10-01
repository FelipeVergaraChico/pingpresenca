import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { initializeInstallation } from '../src/installation.js';
import { buildApp } from '../src/app.js';
import { prepareDemo, reserveDemoWrite, DEMO_WRITES, DEMO_SESSIONS } from '../src/demo/service.js';

test('D1: demonstração em PostgreSQL descartável', async t => {
  const config = parseConfig({ ...process.env, PUBLIC_DEMO: 'true', BOOTSTRAP_SECRET: '' });
  const pool = createPool(config);
  const db = (await pool.query('SELECT current_database() AS name')).rows[0].name;
  assert.match(db, /^pingpresenca_demo_test_/);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    await migrate(pool);
    await initializeInstallation(pool, config);
    await t.test('DEMO-01: flag sem preparo falha; preparo recusa dados existentes sem marcador', async () => {
      await assert.rejects(buildApp(config, pool), { code: 'DEMO_CONFIGURATION' });
      const regular = await buildApp({ ...config, publicDemo: false }, pool);
      try {
        assert.equal((await regular.inject({ method: 'POST', url: '/api/demo/login',
          payload: { profile: 'professor' }, headers: { origin: config.publicOrigin } })).statusCode, 404);
        await assert.rejects(prepareDemo(pool, config), { code: 'DEMO_CONFIGURATION' });
      } finally { await regular.close(); }
      await pool.query("INSERT INTO disciplines(id,name) VALUES('00000000-0000-4000-8000-000000000001','Sentinela')");
      await assert.rejects(prepareDemo(pool, config, true), { code: 'DEMO_CONFIGURATION' });
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM disciplines')).rows[0].n, 1);
      await pool.query("DELETE FROM disciplines WHERE id='00000000-0000-4000-8000-000000000001'");
      await assert.rejects(prepareDemo(pool, { ...config, publicDemo: false }), { code: 'DEMO_CONFIGURATION' });
    });
    await t.test('DEMO-02: preparo cria apenas perfis sintéticos, matrículas e aulas PILOT', async () => {
      await prepareDemo(pool, config);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM accounts')).rows[0].n, 4);
      assert.equal((await pool.query("SELECT 1 FROM account_roles WHERE role IN ('ADMIN','OWNER')")).rowCount, 0);
      assert.equal((await pool.query("SELECT 1 FROM lessons WHERE attendance_mode<>'PILOT'")).rowCount, 0);
      assert.equal((await pool.query(`SELECT 1 FROM lessons l JOIN enrollments e ON e.offering_id=l.offering_id
        WHERE e.enrolled_at>l.starts_at`)).rowCount, 0);
      await assert.rejects(buildApp({ ...config, publicDemo: false }, pool), { code: 'DEMO_CONFIGURATION' });
    });
    app = await buildApp(config, pool);
    let request = 1;
    const post = (url: string, payload: unknown, cookie = '', origin = config.publicOrigin) => app!.inject({
      method: 'POST', url, payload: payload as object, headers: { origin, cookie }, remoteAddress: `192.0.2.${request++}` });
    const get = (url: string, cookie = '') => app!.inject({ url, headers: { cookie } });
    const login = async (profile: string) => {
      const r = await post('/api/demo/login', { profile });
      assert.equal(r.statusCode, 200, r.body);
      assert.match(String(r.headers['set-cookie']), /HttpOnly/i);
      assert.match(String(r.headers['set-cookie']), /SameSite=Strict/i);
      return String(r.headers['set-cookie']).split(';')[0]!;
    };
    await t.test('DEMO-03: origem, papel arbitrário e bypass administrativo são recusados', async () => {
      assert.equal((await post('/api/demo/login', { profile: 'professor' }, '', 'https://invalid.example')).statusCode, 403);
      assert.equal((await post('/api/demo/login', { profile: 'OWNER' })).statusCode, 400);
      assert.equal((await post('/api/demo/login', { profile: 'professor', roles: ['OWNER'] })).statusCode, 400);
      const professor = await login('professor');
      for (const route of ['/api/bootstrap', '/api/auth/login', '/api/admin/accounts', '/api/recovery/complete',
        '/api/offerings', '/api/attendance/settings'])
        assert.equal((await post(route, {}, professor)).statusCode, 403, route);
      assert.equal((await post('/api/lessons', { attendanceMode: 'OFFICIAL' }, professor)).statusCode, 400);
      const installation = (await get('/api/installation')).json();
      assert.equal(installation.initialized, true);
      assert.equal(installation.bootstrapAvailable, false);
      assert.equal(installation.demo.expired, false);
      const secure = await buildApp({ ...config, cookieSecure: true, publicOrigin: 'https://demo.example' }, pool);
      try {
        const response = await secure.inject({ method: 'POST', url: '/api/demo/login',
          headers: { origin: 'https://demo.example' }, payload: { profile: 'aluno-3' } });
        assert.equal(response.statusCode, 200);
        assert.match(String(response.headers['set-cookie']), /^__Host-ping_session=/);
        assert.match(String(response.headers['set-cookie']), /; Secure/i);
      } finally { await secure.close(); }
    });
    let oldStudent = '';
    await t.test('DEMO-04: professor/aluno percorrem chamada real e histórico', async () => {
      const professor = await login('professor');
      oldStudent = await login('aluno-1');
      const me = (await get('/api/auth/me', oldStudent)).json();
      assert.deepEqual(me.roles, ['STUDENT']);
      const lessons = (await pool.query('SELECT * FROM lessons ORDER BY title')).rows;
      const lesson = lessons[0];
      assert.equal((await post(`/api/attendance/${lesson.id}/open`, {}, oldStudent)).statusCode, 404);
      const opened = await post(`/api/attendance/${lesson.id}/open`, {}, professor);
      assert.equal(opened.statusCode, 200, opened.body);
      const projected = (await get(`/api/attendance/${lesson.id}/projection`, professor)).json();
      assert.equal(projected.publicDemo, true);
      const auth = await post(`/api/attendance/${lesson.id}/authorize`, { code: projected.code }, oldStudent);
      assert.equal(auth.statusCode, 200, auth.body);
      assert.equal((await pool.query('SELECT 1 FROM attendance_records')).rowCount, 0);
      const confirmed = await post(`/api/attendance/${lesson.id}/confirm`, { token: auth.json().token,
        geo: { status: 'UNAVAILABLE' } }, oldStudent);
      assert.equal(confirmed.statusCode, 200, confirmed.body);
      assert.equal((await pool.query('SELECT status FROM attendance_records WHERE account_id=$1', [me.id])).rows[0].status, 'PRESENT');
      const view = (await get(`/api/attendance/${lesson.id}`, professor)).json();
      const closed = await post(`/api/attendance/${lesson.id}/close`, { openingId: view.openingId }, professor);
      assert.equal(closed.statusCode, 200, closed.body);
      const history = await get(`/api/attendance/history/${lesson.offering_id}`, oldStudent);
      assert.equal(history.statusCode, 200);
      assert.equal(history.json().frequency.find((f: { mode: string }) => f.mode === 'PILOT').percent, 100);
    });
    await t.test('DEMO-05: limites persistidos são atômicos e expiração bloqueia acesso', async () => {
      await pool.query('UPDATE demo_state SET writes=$1', [DEMO_WRITES - 1]);
      const concurrent = await Promise.allSettled([reserveDemoWrite(pool, false), reserveDemoWrite(pool, false)]);
      assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
      await pool.query('UPDATE demo_state SET writes=0,sessions=$1', [DEMO_SESSIONS]);
      assert.equal((await post('/api/demo/login', { profile: 'professor' })).statusCode, 429);
      await pool.query("UPDATE demo_state SET sessions=0,profiles=jsonb_set(profiles,'{createdLessons}','30')");
      await assert.rejects(reserveDemoWrite(pool, true), { code: 'DEMO_LIMIT' });
      await pool.query("UPDATE demo_state SET expires_at=clock_timestamp()+interval '5 minutes'");
      await login('aluno-2');
      const lifetime = (await pool.query(`SELECT s.expires_at=d.expires_at AS capped
        FROM auth_sessions s CROSS JOIN demo_state d ORDER BY s.created_at DESC LIMIT 1`)).rows[0];
      assert.equal(lifetime.capped, true);
      await pool.query("UPDATE demo_state SET expires_at=clock_timestamp()-interval '1 second'");
      await pool.query("UPDATE auth_sessions SET expires_at=clock_timestamp()-interval '1 second'");
      assert.equal((await get('/api/auth/me', oldStudent)).statusCode, 401);
      assert.equal((await post('/api/demo/login', { profile: 'aluno-1' })).statusCode, 429);
      await assert.rejects(reserveDemoWrite(pool, false), { code: 'DEMO_LIMIT' });
    });
    await t.test('DEMO-06: reset exige API parada e confirmação; invalida dados e sessões antigos', async () => {
      await assert.rejects(prepareDemo(pool, config, true), { code: 'DEMO_CONFIGURATION' });
      await app!.close(); app = undefined;
      await assert.rejects(prepareDemo(pool, config), { code: 'DEMO_CONFIGURATION' });
      await prepareDemo(pool, config, true);
      assert.equal((await pool.query('SELECT 1 FROM attendance_records')).rowCount, 0);
      assert.equal((await pool.query('SELECT 1 FROM auth_sessions')).rowCount, 0);
      assert.equal((await pool.query('SELECT 1 FROM audit_events')).rowCount, 1);
      assert.equal((await pool.query('SELECT 1 FROM schema_migrations')).rowCount, 5);
      app = await buildApp(config, pool);
      assert.equal((await get('/api/auth/me', oldStudent)).statusCode, 401);
    });
  } finally { await app?.close(); await pool.end(); }
});
