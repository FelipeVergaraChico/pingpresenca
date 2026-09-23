import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { initializeInstallation, installationStatus } from '../src/installation.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/identity/password.js';

// This suite refuses a non-test database and never silently skips PostgreSQL.
if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.startsWith('/pingpresenca_test_')
) {
  throw new Error('Use npm run test:integration: exige banco isolado pingpresenca_test_*');
}
const config = parseConfig(process.env);
const payload = {
  name: 'Owner de teste',
  email: 'owner@example.com',
  password: 'test-password-long-123',
  secret: config.bootstrapSecret!,
};
const origin = { origin: config.publicOrigin };

test('E0 integration with real PostgreSQL', async (t) => {
  const pool = createPool(config);
  const secondPool = createPool(config);
  const app = await buildApp(config, pool);
  const second = await buildApp(config, secondPool);
  let ip = 1;
  const post = (url: string, body: unknown = payload, target = app) =>
    target.inject({
      method: 'POST',
      url,
      headers: origin,
      payload: body as object,
      remoteAddress: `127.0.0.${ip++}`,
    });
  async function reset() {
    await pool.query(
      'TRUNCATE audit_events, auth_sessions, account_roles, account_profiles, accounts, installation CASCADE',
    );
    await initializeInstallation(pool, config);
  }
  try {
    await t.test('migration runs concurrently and is repeatable', async () => {
      const results = await Promise.all([migrate(pool), migrate(secondPool)]);
      assert.equal(results.flat().length, 4);
      assert.equal((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count, '4');
      assert.deepEqual(await migrate(pool), []);
    });
    await reset();
    await t.test(
      'A01: wrong secret, invalid origin and extra fields do not create owner',
      async () => {
        assert.equal(
          (await post('/api/bootstrap', { ...payload, secret: 'incorrect' })).statusCode,
          403,
        );
        assert.equal(
          (await app.inject({ method: 'POST', url: '/api/bootstrap', payload })).statusCode,
          403,
        );
        assert.equal(
          (await post('/api/bootstrap', { ...payload, roles: ['OWNER'], serverTime: '2099-01-01' }))
            .statusCode,
          400,
        );
        assert.equal((await pool.query('SELECT count(*) FROM accounts')).rows[0].count, '0');
      },
    );
    await t.test(
      'A02: two HTTP app instances race, exactly one owner and audit event survive',
      async () => {
        const results = await Promise.all([
          post('/api/bootstrap'),
          post('/api/bootstrap', { ...payload, email: 'second@example.com' }, second),
        ]);
        assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
        assert.equal((await pool.query('SELECT count(*) FROM accounts')).rows[0].count, '1');
        assert.equal(
          (await pool.query("SELECT count(*) FROM account_roles WHERE role='OWNER'")).rows[0].count,
          '1',
        );
        assert.equal(
          (await pool.query("SELECT count(*) FROM audit_events WHERE action='OWNER_BOOTSTRAPPED'"))
            .rows[0].count,
          '1',
        );
        assert.equal((await post('/api/bootstrap')).statusCode, 409);
        assert.equal(
          (await pool.query('SELECT email_verified_at FROM account_profiles')).rows[0]
            .email_verified_at,
          null,
        );
      },
    );
    await t.test('A02: database uniqueness independently prevents a second owner', async () => {
      const id = randomUUID();
      await pool.query('INSERT INTO accounts(id,password_hash) VALUES ($1,$2)', [id, 'test-only']);
      await assert.rejects(
        pool.query("INSERT INTO account_roles(account_id,role) VALUES ($1,'OWNER')", [id]),
        { code: '23505' },
      );
    });
    await t.test(
      'A02/A80 partial: restart with removed bootstrap secret preserves state and timezone',
      async () => {
        const withoutSecret = { ...config, bootstrapSecret: undefined };
        await initializeInstallation(secondPool, withoutSecret);
        const restarted = await buildApp(withoutSecret, secondPool);
        try {
          assert.equal((await restarted.inject('/api/installation')).json().initialized, true);
          assert.equal((await post('/api/bootstrap', payload, restarted)).statusCode, 409);
        } finally {
          await restarted.close();
        }
        await assert.rejects(
          initializeInstallation(pool, { ...config, timeZone: 'Europe/Lisbon' }),
          /diverge/,
        );
        assert.equal((await installationStatus(pool)).timeZone, 'America/Sao_Paulo');
      },
    );
    await reset();
    await t.test('E0 transactional audit: audit failure rolls back entire bootstrap', async () => {
      await pool.query(`CREATE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$;
        CREATE TRIGGER test_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_fail_audit()`);
      try {
        const response = await post('/api/bootstrap');
        assert.equal(response.statusCode, 500);
        assert.equal(response.body.includes('synthetic audit'), false);
        assert.equal((await pool.query('SELECT count(*) FROM accounts')).rows[0].count, '0');
        assert.equal((await installationStatus(pool)).initialized, false);
      } finally {
        await pool.query('DROP TRIGGER test_fail ON audit_events; DROP FUNCTION test_fail_audit()');
      }
    });
    await t.test(
      'E0 sessions: real login, hashed storage, authorization, expiry, logout, audit',
      async () => {
        assert.equal((await post('/api/bootstrap')).statusCode, 201);
        assert.equal((await app.inject('/api/admin/installation')).statusCode, 401);
        const signIn = await post('/api/auth/login', {
          email: payload.email,
          password: payload.password,
        });
        assert.equal(signIn.statusCode, 200);
        const setCookie = String(signIn.headers['set-cookie']);
        assert.match(setCookie, /HttpOnly/i);
        assert.match(setCookie, /SameSite=Strict/i);
        const cookie = setCookie.split(';')[0]!;
        const token = cookie.split('=')[1]!;
        const me = await app.inject({ url: '/api/auth/me', headers: { cookie } });
        assert.equal(me.statusCode, 200);
        assert.deepEqual(me.json().roles, ['OWNER']);
        assert.equal(
          (await app.inject({ url: '/api/admin/installation', headers: { cookie } })).statusCode,
          200,
        );
        const sessions = await pool.query('SELECT token_hash FROM auth_sessions');
        assert.notEqual(sessions.rows[0].token_hash, token);
        await pool.query('UPDATE auth_sessions SET expires_at=clock_timestamp()');
        assert.equal(
          (await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode,
          401,
        );
        const another = await post('/api/auth/login', {
          email: payload.email,
          password: payload.password,
        });
        const newCookie = String(another.headers['set-cookie']).split(';')[0]!;
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/auth/logout',
              headers: { ...origin, cookie: newCookie },
              payload: {},
            })
          ).statusCode,
          204,
        );
        assert.equal(
          (await app.inject({ url: '/api/auth/me', headers: { cookie: newCookie } })).statusCode,
          401,
        );
        const audit = await pool.query('SELECT * FROM audit_events');
        const serialized = JSON.stringify(audit.rows);
        assert.equal(serialized.includes(payload.password), false);
        assert.equal(serialized.includes(payload.secret), false);
        assert.equal(serialized.includes(token), false);
        assert.equal(serialized.includes(payload.email), false);
        await assert.rejects(pool.query("UPDATE audit_events SET action='changed'"), /append-only/);
      },
    );
    await t.test(
      'E0 authorization and revocation: browser cannot grant role or reactivate account',
      async () => {
        const id = randomUUID();
        await pool.query('INSERT INTO accounts(id,password_hash) VALUES ($1,$2)', [
          id,
          await hashPassword(payload.password),
        ]);
        await pool.query('INSERT INTO account_profiles(account_id,name,email) VALUES ($1,$2,$3)', [
          id,
          'Professor teste',
          'professor@example.com',
        ]);
        await pool.query("INSERT INTO account_roles(account_id,role) VALUES ($1,'PROFESSOR')", [
          id,
        ]);
        const signIn = await post('/api/auth/login', {
          email: 'professor@example.com',
          password: payload.password,
        });
        const cookie = String(signIn.headers['set-cookie']).split(';')[0]!;
        assert.equal(
          (
            await app.inject({
              url: '/api/admin/installation',
              headers: { cookie, 'x-role': 'OWNER' },
            })
          ).statusCode,
          403,
        );
        await pool.query('UPDATE accounts SET active=false WHERE id=$1', [id]);
        assert.equal(
          (await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode,
          401,
        );
      },
    );
    await t.test(
      'A79/A80 partial: installation and audit timestamps come from database',
      async () => {
        const before = Date.now();
        const status = await app.inject({
          url: '/api/installation',
          headers: { 'x-client-time': '2099-01-01', 'x-time-zone': 'Asia/Tokyo' },
        });
        assert.ok(Math.abs(Date.parse(status.json().serverTime) - before) < 5000);
        assert.equal(status.json().timeZone, config.timeZone);
        const event = (
          await pool.query("SELECT occurred_at FROM audit_events WHERE action='OWNER_BOOTSTRAPPED'")
        ).rows[0];
        assert.ok(Math.abs(event.occurred_at.getTime() - Date.now()) < 60000);
      },
    );
    await t.test('E0 rate limit and generic invalid login response', async () => {
      const request = {
        method: 'POST' as const,
        url: '/api/bootstrap',
        headers: origin,
        payload,
        remoteAddress: '192.0.2.1',
      };
      for (let n = 0; n < 5; n++) await app.inject(request);
      assert.equal((await app.inject(request)).statusCode, 429);
      const response = await post('/api/auth/login', {
        email: 'missing@example.com',
        password: payload.password,
      });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().code, 'INVALID_CREDENTIALS');
    });
  } finally {
    await app.close();
    await second.close();
    await pool.end();
    await secondPool.end();
  }
});
