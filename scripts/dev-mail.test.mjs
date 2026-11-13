import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mailEnvironment } from './dev-mail.mjs';
test('SMTP local substitui provedor somente no processo filho, sem desativar TLS', () => {
  const source = { SMTP_HOST: 'external.example', SMTP_PASSWORD: 'synthetic', DATABASE_URL: 'postgresql://localhost/existing' };
  const result = mailEnvironment(source);
  assert.equal(source.SMTP_HOST, 'external.example');
  assert.equal(result.SMTP_HOST, '127.0.0.1');
  assert.equal(result.SMTP_PASSWORD, '');
  assert.equal(result.DATABASE_URL, source.DATABASE_URL);
  assert.equal(result.SMTP_SECURE, 'false'); // STARTTLS remains mandatory in mail.ts
  assert.ok(result.NODE_EXTRA_CA_CERTS.endsWith('/.local/mailpit/certs/cert.pem'));
  assert.equal(result.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
});
test('não inicia em produção, demo ou com validação TLS desabilitada', () => {
  for (const env of [{ NODE_ENV: 'production' }, { PUBLIC_DEMO: 'true' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }]) assert.throws(() => mailEnvironment(env));
});
test('caixa e SMTP publicados exclusivamente em loopback e sem relay configurado', async () => {
  const compose = await readFile(new URL('../compose.mailpit.yaml', import.meta.url), 'utf8');
  assert.match(compose, /127\.0\.0\.1:18025:8025/);
  assert.match(compose, /127\.0\.0\.1:11025:1025/);
  assert.match(compose, /MP_SMTP_REQUIRE_STARTTLS: "true"/);
  assert.doesNotMatch(compose, /MP_SMTP_RELAY|MP_SMTP_FORWARD/);
});
