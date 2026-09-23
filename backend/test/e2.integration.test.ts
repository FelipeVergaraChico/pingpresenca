import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { initializeInstallation } from '../src/installation.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/identity/password.js';
import { expireDue } from '../src/attendance/service.js';
import { challenge } from '../src/attendance/domain.js';

test('E2 attendance with real PostgreSQL, synthetic accounts only', async (t) => {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.startsWith('/pingpresenca_test_')
  )
    throw new Error('Synthetic database required');
  const config = parseConfig(process.env),
    pool = createPool(config),
    app = await buildApp(config, pool);
  let address = 1;
  const post = (url: string, payload: unknown, cookie = '') =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as object,
      headers: { origin: config.publicOrigin, cookie },
      remoteAddress: `198.51.100.${(address++ % 250) + 1}`,
    });
  const get = (url: string, cookie = '') => app.inject({ url, headers: { cookie } });
  const ok = async (url: string, payload: unknown, cookie: string) => {
    if (url.endsWith('/close')) payload = { ...(payload as object), openingId: (await get(url.slice(0, -6), cookie)).json().openingId };
    const r = await post(url, payload, cookie);
    assert(r.statusCode < 300, `${url}: ${r.statusCode} ${r.body}`);
    return r.json();
  };
  try {
    await migrate(pool);
    await pool.query(
      'TRUNCATE installation,accounts,disciplines,locations,offerings,lessons,audit_events CASCADE',
    );
    await initializeInstallation(pool, config);
    const password = 'synthetic-attendance-password',
      encoded = await hashPassword(password);
    async function account(role: string) {
      const id = randomUUID(),
        email = `${id}@example.test`;
      await pool.query('INSERT INTO accounts(id,password_hash) VALUES($1,$2)', [id, encoded]);
      await pool.query('INSERT INTO account_profiles(account_id,name,email) VALUES($1,$2,$3)', [
        id,
        `${role} synthetic`,
        email,
      ]);
      await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [id, role]);
      const r = await post('/api/auth/login', { email, password });
      assert.equal(r.statusCode, 200);
      return { id, cookie: String(r.headers['set-cookie']).split(';')[0]! };
    }
    const owner = await account('OWNER'),
      teacher = await account('PROFESSOR'),
      outsider = await account('PROFESSOR');
    const students = await Promise.all(Array.from({ length: 5 }, () => account('STUDENT')));
    const discipline = randomUUID(),
      offering = randomUUID(),
      location = randomUUID();
    await pool.query("INSERT INTO disciplines(id,name) VALUES($1,'Discipline')", [discipline]);
    await pool.query(
      "INSERT INTO locations(id,name,latitude,longitude,radius,geo_required) VALUES($1,'Room',-23,-46,100,true)",
      [location],
    );
    await pool.query(
      "INSERT INTO offerings(id,discipline_id,name,term,shift,attendance_mode) VALUES($1,$2,'Offering','2026','Night','PILOT')",
      [offering, discipline],
    );
    await pool.query('INSERT INTO offering_teachers(offering_id,account_id) VALUES($1,$2)', [
      offering,
      teacher.id,
    ]);
    for (const s of students)
      await pool.query(
        "INSERT INTO enrollments(id,offering_id,account_id,enrolled_at) VALUES($1,$2,$3,clock_timestamp()-interval '1 day')",
        [randomUUID(), offering, s.id],
      );
    async function lesson(start = -120, end = 3600, mode = 'PILOT') {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO lessons(id,offering_id,location_id,title,starts_at,ends_at,attendance_mode)
        VALUES($1,$2,$3,'Attendance demo',clock_timestamp()+$4*interval '1 second',clock_timestamp()+$5*interval '1 second',$6)`,
        [id, offering, location, start, end, mode],
      );
      return id;
    }
    const path = (id: string) => `/api/attendance/${id}`;
    const view = async (id: string, cookie = teacher.cookie) =>
      (await get(path(id), cookie)).json();
    const open = async (id: string) => ok(`${path(id)}/open`, {}, teacher.cookie);
    const authorization = async (id: string, s = students[0]!) => {
      const projected = (await get(`${path(id)}/projection`, teacher.cookie)).json();
      const qr = new URL(projected.qrUrl).hash.split('challenge=')[1];
      return ok(`${path(id)}/authorize`, { qr }, s.cookie);
    };
    const submit = async (id: string, geo: unknown, s = students[0]!) => {
      const a = await authorization(id, s);
      return ok(`${path(id)}/confirm`, { token: a.token, geo }, s.cookie);
    };
    const inside = {
      status: 'AVAILABLE',
      latitude: -23,
      longitude: -46,
      accuracy: 5,
    };
    await t.test('REV-E2-01/02: accumulated roles retain participation/history and explicit absence is audited', async () => {
      const dual = await account('ADMIN');
      await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'STUDENT')", [dual.id]);
      let offerings = (await get('/api/offerings', dual.cookie)).json();
      assert.equal(offerings.find((o: any) => o.id === offering).can_view_history, false);
      await pool.query(
        "INSERT INTO enrollments(id,offering_id,account_id,enrolled_at) VALUES($1,$2,$3,clock_timestamp()-interval '1 day')",
        [randomUUID(), offering, dual.id],
      );
      offerings = (await get('/api/offerings', dual.cookie)).json();
      assert.equal(offerings.find((o: any) => o.id === offering).can_manage, true);
      assert.equal(offerings.find((o: any) => o.id === offering).can_view_history, true);
      const id = await lesson();
      await open(id);
      const dualView = await view(id, dual.cookie);
      assert.equal(dualView.manages, true);
      assert(dualView.records.some((r: any) => r.account_id === dual.id));
      const result = await submit(id, inside, dual);
      assert.equal(result.outcome, 'ACCEPTED');
      await ok(`${path(id)}/close`, {}, teacher.cookie);
      const before = (await view(id)).records.find((r: any) => r.account_id === students[4]!.id);
      assert.equal(before.source, 'AUTO_CLOSE');
      await ok(`${path(id)}/decision`, {
        accountId: students[4]!.id, version: before.version, kind: 'CORRECTION',
        status: 'ABSENT', reason: 'Ausência verificada pelo professor',
      }, teacher.cookie);
      const after = await view(id);
      const record = after.records.find((r: any) => r.account_id === students[4]!.id);
      assert.equal(record.status, 'ABSENT');
      assert.equal(record.source, 'CORRECTION');
      assert.equal(record.manual, true);
      assert(after.audit.some((e: any) => e.action === 'ATTENDANCE_CORRECTION'));
      assert.equal((await get(`/api/attendance/history/${offering}`, dual.cookie)).statusCode, 200);
      // Remove only this isolated scenario's fixtures so frequency assertions below remain unchanged.
      await pool.query('DELETE FROM attendance_attempts WHERE authorization_id IN (SELECT a.id FROM attendance_authorizations a JOIN attendance_openings o ON o.id=a.opening_id JOIN attendance_sessions s ON s.id=o.session_id WHERE s.lesson_id=$1)', [id]);
      await pool.query('DELETE FROM attendance_authorizations WHERE opening_id IN (SELECT o.id FROM attendance_openings o JOIN attendance_sessions s ON s.id=o.session_id WHERE s.lesson_id=$1)', [id]);
      await pool.query('DELETE FROM attendance_code_limits WHERE opening_id IN (SELECT o.id FROM attendance_openings o JOIN attendance_sessions s ON s.id=o.session_id WHERE s.lesson_id=$1)', [id]);
      await pool.query('DELETE FROM attendance_openings WHERE session_id IN (SELECT id FROM attendance_sessions WHERE lesson_id=$1)', [id]);
      await pool.query('DELETE FROM attendance_sessions WHERE lesson_id=$1', [id]);
      await pool.query('DELETE FROM attendance_records WHERE lesson_id=$1', [id]);
      await pool.query('DELETE FROM lessons WHERE id=$1', [id]);
      await pool.query('DELETE FROM enrollments WHERE account_id=$1', [dual.id]);
    });
    await t.test(
      'A03/A04/A32/A33/A38: permissions, boundaries and no presence from authorization',
      async () => {
        const early = await lesson(60, 3600),
          past = await lesson(-3600, -1),
          id = await lesson(-120, 60);
        assert.equal((await post(`${path(early)}/open`, {}, teacher.cookie)).statusCode, 409);
        assert.equal((await post(`${path(past)}/open`, {}, teacher.cookie)).statusCode, 409);
        assert.equal((await post(`${path(id)}/open`, {}, outsider.cookie)).statusCode, 404);
        assert.equal((await post(`${path(id)}/open`, {}, students[0]!.cookie)).statusCode, 404);
        assert.equal((await post(`${path(id)}/open`, {}, owner.cookie)).statusCode, 400);
        const opened = await open(id),
          end = (await pool.query('SELECT ends_at FROM lessons WHERE id=$1', [id])).rows[0].ends_at;
        assert.equal(opened.expiresAt, end.toISOString());
        assert.equal((await post(`${path(id)}/open`, {}, teacher.cookie)).statusCode, 409);
        assert.equal((await post(`${path(id)}/authorize`, { code: '000000' })).statusCode, 401);
        const a = await authorization(id);
        assert(new Date(a.expiresAt).getTime() <= end.getTime());
        assert.equal((await view(id)).records.filter((r: any) => r.status).length, 0);
        assert.equal((await pool.query('SELECT 1 FROM attendance_attempts')).rowCount, 0);
        assert.equal(
          (await post(`${path(id)}/confirm`, { token: a.token, geo: inside }, students[1]!.cookie))
            .statusCode,
          400,
        );
        assert.equal(
          (
            await post(
              `${path(id)}/confirm`,
              { token: a.token, geo: { ...inside, latitude: 100 } },
              students[0]!.cookie,
            )
          ).statusCode,
          400,
        );
        await ok(`${path(id)}/confirm`, { token: a.token, geo: inside }, students[0]!.cookie);
      },
    );
    await t.test(
      'A41/A48/A49/A50/A51: attempts, pending preservation, manual protection and idempotency',
      async () => {
        const id = await lesson();
        await open(id);
        assert.equal((await submit(id, { status: 'DENIED' })).outcome, 'PENDING');
        assert.equal((await submit(id, { ...inside, latitude: -24 })).outcome, 'REJECTED');
        let v = await view(id);
        assert.equal(
          v.records.find((r: any) => r.account_id === students[0]!.id).status,
          'PENDING',
        );
        assert.equal(v.attempts.length, 2);
        const a = await authorization(id);
        const results = await Promise.all(
          [1, 2].map(() =>
            ok(`${path(id)}/confirm`, { token: a.token, geo: inside }, students[0]!.cookie),
          ),
        );
        assert.equal(results[0].id, results[1].id);
        v = await view(id);
        const r = v.records.find((r: any) => r.account_id === students[0]!.id);
        assert.equal(r.status, 'PRESENT');
        assert.equal(v.attempts.length, 3);
        assert.equal(v.attempts[0].resolution, 'SUPERSEDED');
        await ok(
          `${path(id)}/decision`,
          {
            accountId: r.account_id,
            version: r.version,
            status: 'ABSENT',
            kind: 'CORRECTION',
            reason: 'Left the classroom',
          },
          teacher.cookie,
        );
        assert.equal((await submit(id, inside)).reason, 'MANUAL_PROTECTED');
        assert.equal(
          (await view(id)).records.find((r: any) => r.account_id === students[0]!.id).status,
          'ABSENT',
        );
        await ok(
          `${path(id)}/decision`,
          {
            accountId: students[1]!.id,
            version: 0,
            status: 'PRESENT',
            kind: 'MANUAL',
            reason: 'No phone',
          },
          teacher.cookie,
        );
        const events = (await view(id)).audit;
        assert(events.some((e: any) => e.action === 'MANUAL_PRESENCE'));
      },
    );
    await t.test(
      'A34/A35/A43/A63/A66/A69/A71/A73: close, pending, own history, projection privacy',
      async () => {
        const id = await lesson(-120, 3600, 'OFFICIAL');
        await open(id);
        await submit(id, inside);
        await submit(id, { status: 'UNAVAILABLE' }, students[1]!);
        const a = await authorization(id, students[2]!);
        const projected = (await get(`${path(id)}/projection`, teacher.cookie)).json();
        assert.equal(JSON.stringify(projected).includes(students[0]!.id), false);
        for (const key of [
          'records',
          'attempts',
          'audit',
          'snapshot',
          'latitude',
          'longitude',
          'challenge_seed',
        ])
          assert.equal(key in projected, false);
        assert.equal((await get(`${path(id)}/projection`, students[0]!.cookie)).statusCode, 404);
        let history = (
          await get(`/api/attendance/history/${offering}`, students[0]!.cookie)
        ).json();
        assert.equal(history.frequency.find((f: any) => f.mode === 'OFFICIAL').percent, null);
        await ok(`${path(id)}/close`, {}, teacher.cookie);
        await ok(`${path(id)}/close`, {}, teacher.cookie);
        assert.equal(
          (await post(`${path(id)}/confirm`, { token: a.token, geo: inside }, students[2]!.cookie))
            .statusCode,
          409,
        );
        const v = await view(id);
        assert.equal(v.records.filter((r: any) => r.status === 'ABSENT').length, 3);
        assert.equal(
          v.records.find((r: any) => r.account_id === students[1]!.id).status,
          'PENDING',
        );
        assert.equal(v.audit.filter((e: any) => e.action === 'ATTENDANCE_CLOSED').length, 1);
        history = (await get(`/api/attendance/history/${offering}`, students[0]!.cookie)).json();
        assert.equal(history.frequency.find((f: any) => f.mode === 'OFFICIAL').percent, 100);
        const own = await view(id, students[0]!.cookie);
        assert.equal(own.records.length, 1);
        assert.equal(own.audit.length, 0);
        assert.equal((await get(`${path(id)}/projection`, teacher.cookie)).json().code, undefined);
      },
    );
    await t.test(
      'A52/A53/A54: pending decisions conflict and audit failure rolls back attendance',
      async () => {
        const id = await lesson();
        await open(id);
        await submit(id, { status: 'DENIED' });
        const pending = (await view(id)).records.find((r: any) => r.account_id === students[0]!.id);
        const decision = {
          accountId: pending.account_id,
          version: pending.version,
          status: 'PRESENT',
          kind: 'PENDING_DECISION',
          reason: 'Observed in classroom',
        };
        const race = await Promise.all([
          post(`${path(id)}/decision`, decision, teacher.cookie),
          post(`${path(id)}/decision`, { ...decision, status: 'ABSENT' }, owner.cookie),
        ]);
        assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 409]);
        assert((await view(id)).audit.some((e: any) => e.action === 'PENDING_DECISION'));
        const a = await authorization(id, students[2]!);
        await pool.query(`CREATE FUNCTION e2_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$;
        CREATE TRIGGER e2_fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION e2_fail_audit()`);
        try {
          assert.equal(
            (
              await post(
                `${path(id)}/confirm`,
                { token: a.token, geo: inside },
                students[2]!.cookie,
              )
            ).statusCode,
            500,
          );
        } finally {
          await pool.query(
            'DROP TRIGGER e2_fail_audit ON audit_events; DROP FUNCTION e2_fail_audit()',
          );
        }
        assert.equal(
          (await view(id)).records.find((r: any) => r.account_id === students[2]!.id).status,
          null,
        );
        await ok(`${path(id)}/confirm`, { token: a.token, geo: inside }, students[2]!.cookie);
      },
    );
    await t.test(
      'A34/A43/A75/A77: automatic expiry, snapshot stability, minimal evidence and replay after closing',
      async () => {
        const id = await lesson();
        await open(id);
        const a = await authorization(id);
        await pool.query('UPDATE locations SET radius=1,latitude=10 WHERE id=$1', [location]);
        const result = await ok(
          `${path(id)}/confirm`,
          { token: a.token, geo: inside },
          students[0]!.cookie,
        );
        assert.equal(result.outcome, 'ACCEPTED');
        const unused = await authorization(id, students[1]!);
        await pool.query(
          `UPDATE attendance_openings SET opened_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 second'
        WHERE session_id=(SELECT id FROM attendance_sessions WHERE lesson_id=$1)`,
          [id],
        );
        assert.equal(
          (
            await post(
              `${path(id)}/confirm`,
              { token: unused.token, geo: inside },
              students[1]!.cookie,
            )
          ).statusCode,
          409,
        );
        await expireDue(pool);
        await expireDue(pool);
        const v = await view(id);
        assert.equal(v.state, 'CLOSED');
        assert.equal(
          v.audit.filter(
            (e: any) => e.action === 'ATTENDANCE_AUTO_CLOSED' && e.actor_kind === 'SYSTEM',
          ).length,
          1,
        );
        assert.equal(
          (
            await ok(
              `${path(id)}/confirm`,
              { token: a.token, geo: { status: 'DENIED' } },
              students[0]!.cookie,
            )
          ).id,
          result.id,
        );
        const tables = ['attendance_attempts', 'attendance_records', 'attendance_authorizations'];
        for (const table of tables) {
          const columns = (
            await pool.query(
              'SELECT column_name FROM information_schema.columns WHERE table_name=$1',
              [table],
            )
          ).rows;
          assert(!columns.some((c) => ['latitude', 'longitude', 'geo'].includes(c.column_name)));
        }
        const raw = (await pool.query('SELECT * FROM attendance_attempts WHERE id=$1', [result.id]))
          .rows[0];
        assert.equal(raw.distance, 0);
        assert.equal(raw.accuracy, 5);
        assert(!JSON.stringify(v.audit).includes(a.token));
        await pool.query('UPDATE locations SET radius=100,latitude=-23 WHERE id=$1', [location]);
      },
    );
    await t.test('E2: persisted per-account guessing limits do not block classmates', async () => {
      const id = await lesson();
      await open(id);
      const projected = (await get(`${path(id)}/projection`, teacher.cookie)).json();
      const invalid = projected.code === '999999' ? '888888' : '999999';
      for (let n = 0; n < 10; n++)
        assert.equal(
          (await post(`${path(id)}/authorize`, { code: invalid }, students[0]!.cookie)).statusCode,
          400,
        );
      assert.equal(
        (await post(`${path(id)}/authorize`, { code: projected.code }, students[0]!.cookie))
          .statusCode,
        429,
      );
      await authorization(id, students[1]!);
    });
    await t.test(
      'A38/A39/A40/A44/A81: expired challenges/authorizations, optional policy and context locking',
      async () => {
        const id = await lesson();
        await open(id);
        const invalidFormat = await post(
          `${path(id)}/authorize`,
          { code: 'abc' },
          students[0]!.cookie,
        );
        assert.equal(invalidFormat.statusCode, 400);
        assert.equal(invalidFormat.json().fieldErrors[0].field, 'code');
        assert.match(invalidFormat.json().message, /seis dígitos/);
        const opening = (
          await pool.query(
            'SELECT o.*,clock_timestamp() AS now FROM attendance_openings o JOIN attendance_sessions s ON s.id=o.session_id WHERE s.lesson_id=$1',
            [id],
          )
        ).rows[0];
        const old = challenge(opening.challenge_seed, opening.now.getTime() - 60000);
        assert.equal(
          (await post(`${path(id)}/authorize`, { qr: old.qr }, students[0]!.cookie)).statusCode,
          400,
        );
        const outsiderStudent = await account('STUDENT');
        const projected = (await get(`${path(id)}/projection`, teacher.cookie)).json();
        assert.equal(
          (await post(`${path(id)}/authorize`, { code: projected.code }, outsiderStudent.cookie))
            .statusCode,
          404,
        );
        const a = await authorization(id);
        await pool.query(
          "UPDATE attendance_authorizations SET expires_at=clock_timestamp()-interval '1 second' WHERE opening_id=$1",
          [opening.id],
        );
        assert.equal(
          (await post(`${path(id)}/confirm`, { token: a.token, geo: inside }, students[0]!.cookie))
            .statusCode,
          409,
        );
        assert.equal((await view(id)).attempts.length, 0);
        const l = (
          await pool.query('SELECT context_locked_at,mode_locked_at FROM lessons WHERE id=$1', [id])
        ).rows[0];
        assert(l.context_locked_at && l.mode_locked_at);
        await pool.query('UPDATE locations SET geo_required=false WHERE id=$1', [location]);
        const optional = await lesson();
        await open(optional);
        assert.equal((await submit(optional, { status: 'UNAVAILABLE' })).outcome, 'ACCEPTED');
        await pool.query('UPDATE locations SET geo_required=true WHERE id=$1', [location]);
      },
    );
    await t.test(
      'D02/A54: rejected later attempt changes review version; settings require admin and version',
      async () => {
        const id = await lesson();
        await open(id);
        await submit(id, { status: 'DENIED' });
        const initial = (await view(id)).records.find((r: any) => r.account_id === students[0]!.id);
        await submit(id, { ...inside, latitude: -24 });
        assert.equal(
          (
            await post(
              `${path(id)}/decision`,
              {
                accountId: students[0]!.id,
                version: initial.version,
                status: 'PRESENT',
                kind: 'PENDING_DECISION',
                reason: 'Reviewed stale context',
              },
              teacher.cookie,
            )
          ).statusCode,
          409,
        );
        const currentRecord = (await view(id)).records.find(
          (r: any) => r.account_id === students[0]!.id,
        );
        assert.equal(currentRecord.status, 'PENDING');
        await ok(
          `${path(id)}/decision`,
          {
            accountId: students[0]!.id,
            version: currentRecord.version,
            status: 'ABSENT',
            kind: 'PENDING_DECISION',
            reason: 'Reviewed complete chronology',
          },
          teacher.cookie,
        );
        assert.equal((await submit(id, inside)).reason, 'MANUAL_PROTECTED');
        assert.equal((await get('/api/attendance/settings', teacher.cookie)).statusCode, 403);
        const settings = (await get('/api/attendance/settings', owner.cookie)).json();
        await ok(
          '/api/attendance/settings',
          { minutes: 7, version: settings.version, reason: 'Institutional default' },
          owner.cookie,
        );
        assert.equal(
          (
            await post(
              '/api/attendance/settings',
              { minutes: 8, version: settings.version, reason: 'Stale settings' },
              owner.cookie,
            )
          ).statusCode,
          409,
        );
        const next = await lesson();
        await open(next);
        const seconds = (
          await pool.query(
            'SELECT extract(epoch FROM o.expires_at-o.opened_at) AS duration FROM attendance_openings o JOIN attendance_sessions s ON s.id=o.session_id WHERE s.lesson_id=$1',
            [next],
          )
        ).rows[0];
        assert.equal(Number(seconds.duration), 420);
      },
    );
  } finally {
    await app.close();
    await pool.end();
  }
});
