import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Writable } from 'node:stream';
import { parseConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { initializeInstallation } from '../src/installation.js';
import { buildApp } from '../src/app.js';
import { hashPassword, digest } from '../src/identity/password.js';
import { expireDue } from '../src/attendance/service.js';

test('E3: PostgreSQL isolado, integridade operacional e recuperação', async t => {
  if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.startsWith('/pingpresenca_test_')) throw new Error('Synthetic database required');
  const config = parseConfig(process.env), pool = createPool(config), app = await buildApp(config, pool);
  let address = 1;
  const post = (url: string, payload: object, cookie = '') => app.inject({ method: 'POST', url, payload, headers: { origin: config.publicOrigin, cookie }, remoteAddress: `198.51.100.${address++ % 250 + 1}` });
  const get = (url: string, cookie = '') => app.inject({ url, headers: { cookie } });
  const ok = async (url: string, body: object, cookie = '') => {
    if (url.endsWith('/close')) body = { ...body, openingId: (await get(url.slice(0, -6), cookie)).json().openingId };
    const r = await post(url, body, cookie); assert(r.statusCode < 300, `${url}: ${r.statusCode} ${r.body}`); return r.json();
  };
  try {
    await migrate(pool);
    await pool.query('TRUNCATE installation,accounts,disciplines,locations,offerings,lessons,audit_events CASCADE');
    await initializeInstallation(pool, config);
    const password = 'synthetic-e3-password', encoded = await hashPassword(password);
    async function account(role: string) {
      const id = randomUUID(), email = `${id}@example.test`;
      await pool.query('INSERT INTO accounts(id,password_hash) VALUES($1,$2)', [id, encoded]);
      await pool.query('INSERT INTO account_profiles(account_id,name,email) VALUES($1,$2,$3)', [id, role, email]);
      await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [id, role]);
      const r = await post('/api/auth/login', { email, password }); assert.equal(r.statusCode, 200);
      return { id, email, cookie: String(r.headers['set-cookie']).split(';')[0]! };
    }
    const owner = await account('OWNER'), admin = await account('ADMIN'), teacher = await account('PROFESSOR');
    const students = await Promise.all(Array.from({ length: 3 }, () => account('STUDENT')));
    const discipline = randomUUID(), offering = randomUUID(), location = randomUUID();
    await pool.query("INSERT INTO disciplines(id,name) VALUES($1,'E3')", [discipline]);
    await pool.query("INSERT INTO locations(id,name,latitude,longitude,radius,geo_required) VALUES($1,'E3 room',-23,-46,100,true)", [location]);
    await pool.query("INSERT INTO offerings(id,discipline_id,name,term,shift,attendance_mode) VALUES($1,$2,'E3','2026','Night','PILOT')", [offering, discipline]);
    await pool.query('INSERT INTO offering_teachers(offering_id,account_id) VALUES($1,$2)', [offering, teacher.id]);
    for (const s of students) await pool.query("INSERT INTO enrollments(id,offering_id,account_id,enrolled_at) VALUES($1,$2,$3,clock_timestamp()-interval '1 day')", [randomUUID(), offering, s.id]);
    async function lesson() {
      const id = randomUUID();
      await pool.query("INSERT INTO lessons(id,offering_id,location_id,title,starts_at,ends_at,attendance_mode) VALUES($1,$2,$3,'E3',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','PILOT')", [id, offering, location]);
      return `/api/attendance/${id}`;
    }
    const view = async (p: string) => (await get(p, teacher.cookie)).json();
    const auth = async (p: string, student = students[0]!) => {
      const projection = (await get(`${p}/projection`, teacher.cookie)).json();
      const qr = new URLSearchParams(new URL(projection.qrUrl).hash.slice(1)).get('challenge');
      return ok(`${p}/authorize`, { qr }, student.cookie);
    };
    const geo = { status: 'AVAILABLE', latitude: -23, longitude: -46, accuracy: 5 };
    await t.test('A36/A37/A43/A67/A70: same session, fresh opening, protected manual decisions and provisional frequency', async () => {
      const p = await lesson(); await ok(`${p}/open`, {}, teacher.cookie);
      const old = await auth(p), pending = await auth(p, students[1]!);
      await ok(`${p}/confirm`, { token: pending.token, geo: { status: 'DENIED' } }, students[1]!.cookie);
      await ok(`${p}/close`, {}, teacher.cookie);
      const closed = await view(p), record = closed.records.find((r: any) => r.account_id === students[2]!.id);
      await ok(`${p}/decision`, { accountId: students[2]!.id, version: record.version, kind: 'CORRECTION', status: 'ABSENT', reason: 'Ausência verificada' }, teacher.cookie);
      await ok(`${p}/reopen`, { openingId: closed.openingId, reason: 'Reabrir para alunos presentes', minutes: 5 }, teacher.cookie);
      assert.equal((await post(`${p}/confirm`, { token: old.token, geo }, students[0]!.cookie)).statusCode, 409);
      assert.equal((await post(`${p}/reopen`, { openingId: closed.openingId, reason: 'Tela antiga' }, teacher.cookie)).statusCode, 409);
      const current = await view(p); assert.notEqual(current.openingId, closed.openingId);
      assert.equal((await post(`${p}/close`, { openingId: closed.openingId }, teacher.cookie)).statusCode, 409);
      assert.equal(current.records.find((r: any) => r.account_id === students[1]!.id).status, 'PENDING');
      const a = await auth(p); await ok(`${p}/confirm`, { token: a.token, geo }, students[0]!.cookie);
      const b = await auth(p, students[2]!); await post(`${p}/confirm`, { token: b.token, geo }, students[2]!.cookie);
      assert.equal((await view(p)).records.find((r: any) => r.account_id === students[2]!.id).status, 'ABSENT');
      assert.equal((await pool.query('SELECT count(*)::int n FROM attendance_sessions WHERE lesson_id=$1', [p.split('/').at(-1)])).rows[0].n, 1);
      const history = (await get(`/api/attendance/history/${offering}`, students[0]!.cookie)).json();
      assert.equal(history.frequency.find((f: any) => f.mode === 'PILOT').provisional, true);
      assert.equal(history.frequency.find((f: any) => f.mode === 'OFFICIAL').percent, null);
      const beforeCancel = await view(p);
      await ok(`${p}/cancel`, { version: beforeCancel.lessonVersion, reason: 'Cancelar ocorrência de teste contabilizada' }, teacher.cookie);
      const cancelledHistory = (await get(`/api/attendance/history/${offering}`, students[0]!.cookie)).json();
      assert.equal(cancelledHistory.frequency.find((f: any) => f.mode === 'PILOT').percent, null);
      assert.equal(cancelledHistory.lessons.find((l: any) => l.id === p.split('/').at(-1)).cancelled, true);
      assert.deepEqual((await view(p)).records, beforeCancel.records);
    });
    await t.test('A28/A59/A67: cancellation preserves history, creates no absence and blocks confirmation', async () => {
      const p = await lesson(); await ok(`${p}/open`, {}, teacher.cookie); const a = await auth(p);
      const before = await view(p);
      await ok(`${p}/cancel`, { version: before.lessonVersion, reason: 'Aula cadastrada incorretamente' }, teacher.cookie);
      const after = await view(p); assert.equal(after.state, 'CANCELLED');
      assert.equal(after.records.filter((r: any) => r.status).length, 0);
      assert.equal((await post(`${p}/confirm`, { token: a.token, geo }, students[0]!.cookie)).statusCode, 409);
      assert.equal((await get(`${p}/projection`, teacher.cookie)).json().open, false);
      assert(after.audit.some((e: any) => e.action === 'LESSON_CANCELLED'));
    });
    await t.test('A27/A28: location changes require closed session and preserve earlier snapshot', async () => {
      const p = await lesson(); await ok(`${p}/open`, {}, teacher.cookie); let v = await view(p);
      assert.equal((await post(`${p}/location`, { version: v.lessonVersion, reason: 'Outra sala', locationId: location }, teacher.cookie)).statusCode, 409);
      await ok(`${p}/close`, {}, teacher.cookie); v = await view(p);
      const before = (await pool.query('SELECT snapshot FROM attendance_openings WHERE id=$1', [v.openingId])).rows[0];
      await ok(`${p}/location`, { version: v.lessonVersion, reason: 'Local revisado', locationId: location }, teacher.cookie);
      assert.equal((await post(`${p}/location`, { version: v.lessonVersion, reason: 'Tela antiga', locationId: location }, teacher.cookie)).statusCode, 409);
      assert.deepEqual((await pool.query('SELECT snapshot FROM attendance_openings WHERE id=$1', [v.openingId])).rows[0], before);
    });
    await t.test('A35/A43/A54/A55: expiration after downtime and competing workers are idempotent', async () => {
      const p = await lesson(); await ok(`${p}/open`, {}, teacher.cookie); const a = await auth(p);
      await pool.query("UPDATE attendance_openings SET opened_at=clock_timestamp()-interval '1 minute', expires_at=clock_timestamp()-interval '1 millisecond' WHERE id=$1", [(await view(p)).openingId]);
      await Promise.all([expireDue(pool), expireDue(pool)]);
      assert.equal((await post(`${p}/confirm`, { token: a.token, geo }, students[0]!.cookie)).statusCode, 409);
      const v = await view(p); assert.equal(v.state, 'CLOSED'); assert.equal(v.records.filter((r: any) => r.status === 'ABSENT').length, 3);
      assert.equal(v.audit.filter((e: any) => e.action === 'ATTENDANCE_AUTO_CLOSED').length, 1);
    });
    await t.test('A52/A54/A55: concurrent confirmation, manual decision and closing serialize without overwrites', async () => {
      const p = await lesson(); await ok(`${p}/open`, {}, teacher.cookie);
      const initial = await auth(p); await ok(`${p}/confirm`, { token: initial.token, geo: { status: 'DENIED' } }, students[0]!.cookie);
      const v = await view(p), record = v.records.find((r: any) => r.account_id === students[0]!.id), a = await auth(p);
      const [manual, automatic] = await Promise.all([
        post(`${p}/decision`, { accountId: students[0]!.id, version: record.version, status: 'ABSENT', kind: 'PENDING_DECISION', reason: 'Professor conferiu ausência' }, teacher.cookie),
        post(`${p}/confirm`, { token: a.token, geo }, students[0]!.cookie),
      ]);
      assert.equal(automatic.statusCode, 200);
      const final = (await view(p)).records.find((r: any) => r.account_id === students[0]!.id);
      if (manual.statusCode === 200) { assert.equal(final.manual, true); assert.equal(final.status, 'ABSENT'); assert.equal(automatic.json().reason, 'MANUAL_PROTECTED'); }
      else { assert.equal(manual.statusCode, 409); assert.equal(final.status, 'PRESENT'); }
      const b = await auth(p, students[1]!);
      const [closing, attempt] = await Promise.all([
        post(`${p}/close`, { openingId: v.openingId }, teacher.cookie),
        post(`${p}/confirm`, { token: b.token, geo }, students[1]!.cookie),
      ]);
      assert.equal(closing.statusCode, 200); assert([200,409].includes(attempt.statusCode));
      const after = await view(p); assert.equal(after.state, 'CLOSED');
      assert.equal(after.records.find((r: any) => r.account_id === students[1]!.id).status, attempt.statusCode === 200 ? 'PRESENT' : 'ABSENT');
      const violations = await pool.query(`SELECT 1 FROM attendance_attempts t JOIN attendance_authorizations a ON a.id=t.authorization_id JOIN attendance_openings o ON o.id=a.opening_id WHERE o.id=$1 AND t.outcome='ACCEPTED' AND t.recorded_at>=o.closed_at`, [v.openingId]);
      assert.equal(violations.rowCount, 0);
    });
    await t.test('A54/A75/A76: failed audit rolls back and structured error log excludes private payload and database error', async () => {
      const p = await lesson(); await ok(`${p}/open`, {}, teacher.cookie); const a = await auth(p);
      let logs = '';
      const logged = await buildApp(config, pool, { logger: { stream: new Writable({ write(chunk, _encoding, callback) { logs += chunk.toString(); callback(); } }) } });
      await pool.query("CREATE FUNCTION reject_e3_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ATTENDANCE_ATTEMPT' THEN RAISE EXCEPTION 'private_database_marker_e3'; END IF; RETURN NEW; END $$");
      await pool.query('CREATE TRIGGER reject_e3_attempt BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_e3_attempt()');
      try {
        const result = await logged.inject({ method: 'POST', url: `${p}/confirm`, headers: { origin: config.publicOrigin, cookie: students[0]!.cookie }, payload: { token: a.token, geo: { status: 'AVAILABLE', latitude: -23.1234567, longitude: -46.7654321, accuracy: 3 } } });
        assert.equal(result.statusCode, 500);
        assert(logs.includes('Falha interna'));
        for (const secret of [a.token, students[0]!.cookie, '-23.1234567', '-46.7654321', 'private_database_marker_e3']) assert(!logs.includes(secret));
        assert.equal((await view(p)).records.filter((r: any) => r.status).length, 0);
      } finally {
        await pool.query('DROP TRIGGER reject_e3_attempt ON audit_events');
        await pool.query('DROP FUNCTION reject_e3_attempt()');
        await logged.close();
      }
    });
    await t.test('A11–A15: recovery hierarchy, single use, session revocation and unverified email', async () => {
      assert.equal((await post(`/api/admin/accounts/${owner.id}/recovery`, { reason: 'Proibido via web' }, owner.cookie)).statusCode, 403);
      assert.equal((await post(`/api/admin/accounts/${admin.id}/recovery`, { reason: 'Não pode recuperar admin' }, admin.cookie)).statusCode, 403);
      assert.equal((await post(`/api/admin/accounts/${students[0]!.id}/recovery`, { reason: 'Professor não administra' }, teacher.cookie)).statusCode, 403);
      const issue = () => ok(`/api/admin/accounts/${students[0]!.id}/recovery`, { reason: 'Identidade conferida presencialmente' }, admin.cookie);
      const tokenOf = (r: any) => new URLSearchParams(new URL(r.url).hash.slice(1)).get('recovery')!;
      const adminToken = tokenOf(await ok(`/api/admin/accounts/${admin.id}/recovery`, { reason: 'Owner verificou identidade administrativa' }, owner.cookie));
      await ok('/api/recovery/inspect', { token: adminToken });
      const promoted = students[2]!;
      const obsolete = tokenOf(await ok(`/api/admin/accounts/${promoted.id}/recovery`, { reason: 'Solicitação anterior à promoção' }, admin.cookie));
      const version = (await pool.query('SELECT version FROM accounts WHERE id=$1', [promoted.id])).rows[0].version;
      await ok(`/api/admin/accounts/${promoted.id}/roles`, { roles: ['STUDENT', 'ADMIN'], version, reason: 'Promoção autorizada pelo owner' }, owner.cookie);
      assert.equal((await post('/api/recovery/inspect', { token: obsolete })).statusCode, 410);
      const expired = tokenOf(await issue());
      await pool.query("UPDATE password_recoveries SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1", [digest(expired)]);
      assert.equal((await post('/api/recovery/complete', { token: expired, password: 'irrelevant-password' })).statusCode, 410);
      const old = tokenOf(await issue()), token = tokenOf(await issue());
      assert.equal((await post('/api/recovery/inspect', { token: old })).statusCode, 410);
      assert.equal((await app.inject({ method: 'POST', url: '/api/recovery/inspect', payload: { token }, headers: { origin: 'https://untrusted.example.test' } })).statusCode, 403);
      assert.equal((await post('/api/recovery/complete', { token, password: 'irrelevant-password', roles: ['OWNER'] })).statusCode, 400);
      await ok('/api/recovery/inspect', { token });
      const results = await Promise.all([post('/api/recovery/complete', { token, password: 'new-synthetic-password' }), post('/api/recovery/complete', { token, password: 'new-synthetic-password' })]);
      assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 410]);
      assert.equal((await get('/api/auth/me', students[0]!.cookie)).statusCode, 401);
      assert.equal((await pool.query('SELECT email_verified_at FROM account_profiles WHERE account_id=$1', [students[0]!.id])).rows[0].email_verified_at, null);
      await ok('/api/recovery/complete', { token: adminToken, password: 'new-admin-synthetic-password' });
      assert.equal((await get('/api/auth/me', admin.cookie)).statusCode, 401);
      const cli = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/identity/recover-owner-cli.ts', '--reason', 'Acesso ao servidor conferido'], { env: { ...process.env, BOOTSTRAP_SECRET: '' } });
      const ownerLink = { url: cli.stdout.trim().split('\n').at(-1)! };
      await ok('/api/recovery/complete', { token: tokenOf(ownerLink), password: 'new-owner-synthetic-password' });
      assert.equal((await get('/api/auth/me', owner.cookie)).statusCode, 401);
      assert.equal((await pool.query("SELECT count(*)::int n FROM account_roles WHERE role='OWNER'")).rows[0].n, 1);
      assert.equal((await pool.query("SELECT actor_kind FROM audit_events WHERE action='RECOVERY_INITIATED' AND target_id=$1 ORDER BY occurred_at DESC LIMIT 1", [owner.id])).rows[0].actor_kind, 'INFRASTRUCTURE');
    });
    await t.test('E3 carga preliminar / A55: turma sintética de 80 alunos, HTTP real e dez fluxos concorrentes (não certifica A93)', async () => {
      const cookies: string[] = [];
      for (let i = 0; i < 80; i++) {
        const id = randomUUID(), token = randomBytes(32).toString('base64url');
        await pool.query('INSERT INTO accounts(id,password_hash) VALUES($1,$2)', [id, encoded]);
        await pool.query('INSERT INTO account_profiles(account_id,name,email) VALUES($1,$2,$3)', [id, `Load ${i}`, `${id}@example.test`]);
        await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'STUDENT')", [id]);
        await pool.query("INSERT INTO enrollments(id,offering_id,account_id,enrolled_at) VALUES($1,$2,$3,clock_timestamp()-interval '1 day')", [randomUUID(), offering, id]);
        await pool.query("INSERT INTO auth_sessions(token_hash,account_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')", [digest(token), id]);
        cookies.push(`ping_session=${token}`);
      }
      const p = await lesson(); await ok(`${p}/open`, {}, teacher.cookie);
      const origin = await app.listen({ host: '127.0.0.1', port: 0 });
      const latencies: number[] = [], authorizationLatencies: number[] = [], confirmationLatencies: number[] = [], flows: number[] = []; let cursor = 0, expectedRejections = 0, projectionRequests = 0;
      const started = performance.now(), cpu = process.cpuUsage();
      const request = async (suffix: string, body: object, cookie: string) => {
        const begin = performance.now();
        const r = await fetch(`${origin}${p}/${suffix}`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: config.publicOrigin, cookie }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
        const result = await r.json(), elapsed = performance.now() - begin; latencies.push(elapsed);
        (suffix === 'authorize' ? authorizationLatencies : confirmationLatencies).push(elapsed);
        if (suffix === 'authorize' && r.status === 400 && result.code === 'INVALID_CODE') { expectedRejections++; return { retry: true }; }
        assert.equal(r.status, 200, JSON.stringify(result)); return result;
      };
      assert.equal((await request('authorize', { qr: 'a'.repeat(43) }, cookies[0]!)).retry, true);
      const workers = await Promise.allSettled(Array.from({ length: 10 }, async () => {
        while (cursor < cookies.length) {
          const cookie = cookies[cursor++]!;
          const flowStart = performance.now();
          let a: { token?: string; retry?: boolean } = {};
          for (let read = 0; read < 3; read++) {
            projectionRequests++;
            const projected = await (await fetch(`${origin}${p}/projection`, { headers: { cookie: teacher.cookie }, signal: AbortSignal.timeout(15000) })).json();
            const qr = new URLSearchParams(new URL(projected.qrUrl).hash.slice(1)).get('challenge');
            a = await request('authorize', { qr }, cookie);
            if (!a.retry) break;
          }
          assert(a.token, 'Three fresh scans failed; investigate latency/rotation');
          const result = await request('confirm', { token: a.token, geo }, cookie);
          assert.equal(result.outcome, 'ACCEPTED');
          flows.push(performance.now() - flowStart);
          // Idempotent replay adds traffic without duplicating the academic result.
          const replay = await request('confirm', { token: a.token, geo }, cookie);
          assert.equal(replay.replay, true);
        }
      }));
      for (const result of workers) if (result.status === 'rejected') throw result.reason;
      const seconds = (performance.now() - started) / 1000, used = process.cpuUsage(cpu);
      latencies.sort((a,b) => a-b);
      const count = (await pool.query("SELECT count(*)::int n FROM attendance_records WHERE lesson_id=$1 AND status='PRESENT'", [p.split('/').at(-1)])).rows[0].n;
      assert.equal(count, 80);
      const metrics = (values: number[]) => { values.sort((a,b) => a-b); return { count: values.length, p95Ms: values[Math.ceil(values.length*.95)-1], p99Ms: values[Math.ceil(values.length*.99)-1] }; };
      console.log(JSON.stringify({ scenario: 'E3 synthetic classroom, not E6 capacity certification', students: 80, concurrency: 10, requests: latencies.length, projectionRequests, expectedRejections, internalErrors: 0, seconds, requestsPerSecond: latencies.length / seconds, authorization: metrics(authorizationLatencies), confirmationIncludingReplay: metrics(confirmationLatencies), completeFlowIncludingProjection: metrics(flows), cpuMs: (used.user+used.system)/1000, rssMiB: process.memoryUsage().rss/1024/1024, confirmed: count, node: process.version }));
    });
  } finally { app.server.closeAllConnections(); await app.close(); await pool.end(); }
});
