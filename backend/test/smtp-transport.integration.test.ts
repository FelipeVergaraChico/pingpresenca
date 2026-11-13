import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:tls';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { createMailSender } from '../src/identity/mail.js';
import { parseConfig } from '../src/config.js';

// Real SMTP/TLS on loopback. Requires openssl; no external provider or real address.
test('E5.3: transporte SMTP real com TLS, destinatário único e rejeição', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ping-smtp-test-'));
  const keyPath = join(directory, 'key.pem'), certPath = join(directory, 'cert.pem');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath,
      '-out', certPath, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    const cert = await readFile(certPath), key = await readFile(keyPath);
    let rejectRecipient = false;
    let received = '';
    const recipients: string[] = [];
    const server = createServer({ cert, key }, socket => {
      socket.setEncoding('utf8');
      socket.on('error', () => {});
      socket.write('220 localhost test SMTP\r\n');
      let buffer = '', inData = false;
      socket.on('data', data => {
        buffer += data;
        while (buffer.includes('\r\n')) {
          const split = buffer.indexOf('\r\n');
          const line = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          if (inData) {
            if (line === '.') { inData = false; socket.write('250 accepted\r\n'); }
            else received += line + '\n';
          } else if (/^EHLO|^HELO/.test(line)) socket.write('250 localhost\r\n');
          else if (/^MAIL FROM/.test(line)) socket.write('250 sender ok\r\n');
          else if (/^RCPT TO/.test(line)) { recipients.push(line); socket.write(rejectRecipient ? '550 rejected\r\n' : '250 recipient ok\r\n'); }
          else if (line === 'DATA') { inData = true; socket.write('354 send data\r\n'); }
          else if (line === 'QUIT') socket.end('221 bye\r\n');
          else socket.write('250 ok\r\n');
        }
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const transport = nodemailer.createTransport.bind(nodemailer);
    // Trust only this ephemeral test certificate; production keeps normal CA validation.
    t.mock.method(nodemailer, 'createTransport', (options: SMTPTransport.Options) => transport({ ...options, tls: { ...options.tls, ca: cert } }));
    try {
      const config = parseConfig({ PUBLIC_ORIGIN: 'http://localhost:5173', COOKIE_SECURE: 'false', INSTALLATION_NAME: 'Teste',
        INSTALLATION_TIME_ZONE: 'America/Sao_Paulo', DATABASE_URL: 'postgresql://test:test@localhost/test',
        SMTP_HOST: '127.0.0.1', SMTP_PORT: String((server.address() as { port: number }).port), SMTP_SECURE: 'true', SMTP_FROM: 'sender@example.com' });
      const message = { to: 'student@example.com', url: 'https://example.com/#invite=synthetic', installationName: 'Teste' };
      await createMailSender(config)(message);
      assert.equal(recipients.length, 1);
      assert.match(recipients[0]!, /student@example.com/);
      assert.match(received, /#invite/);
      assert.ok(!received.includes('Bcc:'));
      rejectRecipient = true;
      await assert.rejects(createMailSender(config)(message), /Não foi possível confirmar/);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
