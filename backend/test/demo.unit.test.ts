import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.js';
import { demoWriteAllowed } from '../src/demo/routes.js';

const env = { PUBLIC_ORIGIN: 'http://localhost:5173', COOKIE_SECURE: 'false',
  INSTALLATION_NAME: 'Teste', INSTALLATION_TIME_ZONE: 'America/Sao_Paulo', POSTGRES_PASSWORD: 'synthetic' };
test('DEMO-01: desativada por padrão; modo inválido ou segredo de bootstrap recusados', () => {
  assert.equal(parseConfig(env).publicDemo, false);
  assert.equal(parseConfig({ ...env, PUBLIC_DEMO: 'true', POSTGRES_DB: 'pingpresenca_demo_unit' }).publicDemo, true);
  assert.throws(() => parseConfig({ ...env, PUBLIC_DEMO: 'true', POSTGRES_DB: 'pingpresenca' }));
  assert.throws(() => parseConfig({ ...env, PUBLIC_DEMO: 'true', DATABASE_URL: 'postgresql://test:synthetic@localhost/real_database' }));
  assert.throws(() => parseConfig({ ...env, PUBLIC_DEMO: 'yes' }));
  assert.throws(() => parseConfig({ ...env, PUBLIC_DEMO: 'true', BOOTSTRAP_SECRET: 'x'.repeat(40) }));
});
test('DEMO-03: allowlist de escrita não concede novas rotas automaticamente', () => {
  for (const path of ['/api/lessons', '/api/lessons/:id', '/api/attendance/:id/confirm', '/api/attendance/:id/reopen'])
    assert.equal(demoWriteAllowed(path), true);
  for (const path of ['/api/bootstrap', '/api/auth/login', '/api/admin/accounts', '/api/recovery/complete',
    '/api/offerings/:id/enrollments', '/api/attendance/settings', '/api/future-route'])
    assert.equal(demoWriteAllowed(path), false);
});
