import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { parseConfig } from '../src/config.js';
import { createMailSender, smtpOptions } from '../src/identity/mail.js';

const env = { PUBLIC_ORIGIN: 'http://localhost:5173', COOKIE_SECURE: 'false', INSTALLATION_NAME: 'Teste',
  INSTALLATION_TIME_ZONE: 'America/Sao_Paulo', DATABASE_URL: 'postgresql://test:test@localhost/test' };
test('E5.3 SMTP: configuração é opcional, completa e proibida na demo', () => {
  assert.equal(parseConfig(env).smtp, undefined);
  assert.throws(() => parseConfig({ ...env, SMTP_HOST: 'smtp.example.com' }), /SMTP/);
  assert.throws(() => parseConfig({ ...env, SMTP_PASSWORD: 'private-value' }), error => !String(error).includes('private-value'));
  assert.throws(() => parseConfig({ ...env, SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'sender@example.com', PUBLIC_DEMO: 'true' }), /demonstração/);
  const smtp = parseConfig({ ...env, SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'sender@example.com' }).smtp!;
  assert.equal(smtpOptions(smtp).requireTLS, true);
  assert.equal(smtpOptions(smtp).tls.rejectUnauthorized, true);
  assert.equal(smtpOptions(smtp).debug, false);
  assert.equal(smtpOptions(smtp).disableUrlAccess, true);
  assert.equal(smtpOptions({ ...smtp, secure: true }).secure, true);
});
test('E5.3 SMTP: destinatário rejeitado e erro do provedor não vazam segredos', async t => {
  const config = parseConfig({ ...env, SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'sender@example.com' });
  let sent: unknown;
  let failure = false;
  t.mock.method(nodemailer, 'createTransport', () => ({
    close() {},
    async sendMail(message: unknown) { sent = message; if (failure) throw Error('secret-token smtp-password'); return { accepted: [] }; },
  }));
  for (failure of [false, true]) await assert.rejects(createMailSender(config)({ to: 'student@example.com', url: 'https://example.com/#invite=secret-token', installationName: 'Teste' }),
    error => String(error).includes('Não foi possível confirmar') && !String(error).includes('secret-token') && !String(error).includes('smtp-password'));
  assert.equal((sent as { to: string }).to, 'student@example.com');
});
