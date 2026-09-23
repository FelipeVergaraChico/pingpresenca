import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.js';
import {
  formatInstant,
  isTimeZone,
  isWithinInterval,
  localToInstant,
} from '../src/platform/time.js';
import { hashPassword, sameSecret, verifyPassword } from '../src/identity/password.js';
import { requirePermission } from '../src/identity/authorization.js';
import { eligible, plannedInstant, policySnapshot } from '../src/academic/domain.js';
import { z } from 'zod';
import { validationErrors } from '../src/platform/validation.js';

const env = {
  PUBLIC_ORIGIN: 'http://localhost:5173',
  COOKIE_SECURE: 'false',
  INSTALLATION_NAME: 'Instalação de teste',
  INSTALLATION_TIME_ZONE: 'America/Sao_Paulo',
  POSTGRES_PASSWORD: 'test-only-password',
};

test('E1/A83: validation describes public fields without reflecting values or unknown keys', () => {
  const schema = z.strictObject({
    name: z.string().trim().min(2),
    email: z.email(),
    password: z.string().min(12),
    radius: z.number().positive(),
    roles: z.array(z.enum(['STUDENT'])).min(1),
  });
  const result = schema.safeParse({
    name: ' ',
    email: 'sensitive-email',
    password: 'secret',
    radius: 0,
    roles: [],
    'private-unknown-key': 'sensitive-value',
  });
  assert.equal(result.success, false);
  if (result.success) return;
  const errors = validationErrors(result.error.issues);
  assert.deepEqual(
    errors.map((e) => e.field),
    ['name', 'email', 'password', 'radius', 'roles'],
  );
  assert.match(errors[0]!.message, /pelo menos 2 caracteres/);
  assert.match(errors[1]!.message, /e-mail válido/);
  assert.match(errors[2]!.message, /12 caracteres/);
  assert.match(errors[3]!.message, /maior que 0/);
  assert.match(errors[4]!.message, /Selecione pelo menos 1/);
  for (const value of ['sensitive-email', 'secret', 'private-unknown-key', 'sensitive-value'])
    assert.equal(JSON.stringify(errors).includes(value), false);
});

test('E1/A83: validation handles ranges, options, nested groups and unknown paths safely', () => {
  const result = z
    .strictObject({
      latitude: z.number().min(-90).max(90),
      description: z.string().max(5),
      attendanceMode: z.enum(['PILOT', 'OFFICIAL']),
      teacherIds: z.array(z.uuid()),
      radius: z.number(),
    })
    .safeParse({
      latitude: 91,
      description: 'long description',
      attendanceMode: 'SECRET',
      teacherIds: ['invalid', 'invalid'],
      radius: null,
    });
  if (result.success) assert.fail('Should fail validation');
  const errors = validationErrors(result.error.issues);
  assert.match(errors.find((e) => e.field === 'latitude')!.message, /menor ou igual a 90/);
  assert.match(errors.find((e) => e.field === 'description')!.message, /no máximo 5/);
  assert.match(errors.find((e) => e.field === 'radius')!.message, /número válido/);
  assert.equal(errors.filter((e) => e.field === 'teacherIds').length, 1);
  assert.equal(JSON.stringify(errors).includes('SECRET'), false);
  const token = z.strictObject({ token: z.string().min(43) }).safeParse({ token: 'private-token' });
  if (token.success) assert.fail('Should fail validation');
  assert.deepEqual(validationErrors(token.error.issues), []);
});

test('E0 config: rejects invalid zone, weak bootstrap secret, invalid port and placeholder credentials', () => {
  for (const override of [
    { INSTALLATION_TIME_ZONE: 'Mars/Olympus' },
    { BOOTSTRAP_SECRET: 'short' },
    { API_PORT: 'wrong' },
    { POSTGRES_PASSWORD: 'SUBSTITUA_POR_ALGO' },
  ]) {
    assert.throws(() => parseConfig({ ...env, ...override }));
  }
  assert.equal(parseConfig(env).timeZone, 'America/Sao_Paulo');
  assert.equal(parseConfig(env).bootstrapSecret, undefined);
});
test('E0 config: requires HTTPS and secure cookie for non-loopback installations', () => {
  assert.throws(() => parseConfig({ ...env, PUBLIC_ORIGIN: 'http://school.example' }));
  assert.throws(() => parseConfig({ ...env, PUBLIC_ORIGIN: 'https://school.example' }));
  assert.equal(
    parseConfig({ ...env, PUBLIC_ORIGIN: 'https://school.example', COOKIE_SECURE: 'true' })
      .cookieSecure,
    true,
  );
  assert.throws(() => parseConfig({ ...env, PUBLIC_ORIGIN: 'http://localhost:5173/path' }));
});
test('E0 config errors do not reflect credentials from malformed DATABASE_URL', () => {
  assert.throws(
    () => parseConfig({ ...env, DATABASE_URL: 'private-credential-value' }),
    (error) => error instanceof Error && !error.message.includes('private-credential-value'),
  );
});
test('A79/A80 partial: explicit installation zone produces UTC instant independent of process zone', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Pacific/Honolulu', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      assert.equal(
        localToInstant('2026-09-10T19:00:00', 'America/Sao_Paulo'),
        '2026-09-10T22:00:00Z',
      );
      assert.match(
        formatInstant('2026-09-11T01:30:00Z', 'America/Sao_Paulo'),
        /10\/09\/2026.*22:30:00/,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
test('A81 partial: shared time primitive uses inclusive start and exclusive end', () => {
  const start = '2026-09-10T22:00:00Z';
  const end = '2026-09-11T00:00:00Z';
  assert.equal(isWithinInterval(start, start, end), true);
  assert.equal(isWithinInterval('2026-09-10T23:59:59.999Z', start, end), true);
  assert.equal(isWithinInterval(end, start, end), false);
  assert.equal(isWithinInterval('2026-09-10T21:59:59Z', start, end), false);
});
test('E0 time: rejects ambiguous and nonexistent local times instead of silently shifting', () => {
  assert.throws(() => localToInstant('2026-11-01T01:30:00', 'America/New_York'));
  assert.throws(() => localToInstant('2026-03-08T02:30:00', 'America/New_York'));
  assert.equal(isTimeZone('+03:00'), false);
});
test('E0 password: salted scrypt verifies without retaining plaintext', async () => {
  const password = 'synthetic password only';
  const hash = await hashPassword(password);
  assert.equal(hash.includes(password), false);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('incorrect password', hash), false);
  assert.equal(sameSecret('wrong', 'long-secret'), false);
  assert.equal(sameSecret('same', 'same'), true);
});
test('E0 authorization: no principal and insufficient roles fail on server permission guard', () => {
  assert.throws(() => requirePermission(null, 'installation:read'), { status: 401 });
  assert.throws(
    () =>
      requirePermission(
        { id: 'test', name: 'Test', email: 'test@example.com', roles: ['PROFESSOR'] },
        'installation:read',
      ),
    { status: 403 },
  );
  assert.doesNotThrow(() =>
    requirePermission(
      { id: 'test', name: 'Test', email: 'test@example.com', roles: ['OWNER'] },
      'installation:read',
    ),
  );
});
test('A19/A20: eligibility uses planned start and half-open enrollment interval', () => {
  const start = '2026-09-10T22:00:00Z';
  assert.equal(eligible(start, start, null), true);
  assert.equal(eligible(start, '2026-09-10T22:00:01Z', null), false);
  assert.equal(eligible(start, '2026-09-01T00:00:00Z', start), false);
  assert.equal(eligible(start, '2026-09-01T00:00:00Z', '2026-09-10T22:01:00Z'), true);
});
test('A28/A31 foundations: snapshot is immutable, detached and carries precision rule/version', () => {
  const location = {
    id: 'local',
    name: 'Sala',
    latitude: 10,
    longitude: 20,
    radius: 100,
    geo_required: true,
    precision_rule: 'CONSERVATIVE_V1',
    version: 1,
  };
  const snapshot = policySnapshot(location);
  location.radius = 200;
  location.version = 2;
  assert.equal(snapshot.radius, 100);
  assert.equal(snapshot.locationVersion, 1);
  assert.equal(snapshot.precisionRule, 'CONSERVATIVE_V1');
  assert.ok(Object.isFrozen(snapshot));
});
test('E1 planning: rejects offsets, malformed dates and ambiguous/nonexistent times', () => {
  for (const input of ['2026-09-10T19:00Z', '2026-02-30T19:00', '2026-09-10T19:00-03:00'])
    assert.throws(() => plannedInstant(input, 'America/Sao_Paulo'));
  assert.throws(() => plannedInstant('2026-11-01T01:30', 'America/New_York'));
  assert.equal(plannedInstant('2026-09-10T23:30', 'America/Sao_Paulo'), '2026-09-11T02:30:00Z');
});
