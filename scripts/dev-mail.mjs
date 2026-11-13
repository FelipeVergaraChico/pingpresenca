import { execFileSync, spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const certDir = join(root, '.local/mailpit/certs');
const cert = join(certDir, 'cert.pem');
const key = join(certDir, 'key.pem');

export function mailEnvironment(current = process.env) {
  if (current.NODE_ENV === 'production') throw new Error('Caixa local exclusiva para desenvolvimento.');
  if (current.PUBLIC_DEMO === 'true') throw new Error('Não use SMTP na demonstração pública.');
  if (current.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Remova NODE_TLS_REJECT_UNAUTHORIZED=0; TLS precisa ser validado.');
  return { ...current, NODE_ENV: 'development', NODE_EXTRA_CA_CERTS: cert,
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '11025', SMTP_SECURE: 'false',
    SMTP_FROM: 'convites@pingpresenca.test', SMTP_USER: '', SMTP_PASSWORD: '',
    npm_config_registry: 'https://registry.npmmirror.com' };
}

function compose(...args) {
  execFileSync('docker', ['compose', '-f', join(root, 'compose.mailpit.yaml'), ...args], { cwd: root, stdio: 'inherit' });
}

async function start() {
  await mkdir(certDir, { recursive: true, mode: 0o700 });
  await mkdir(join(root, '.local/mailpit/data'), { recursive: true, mode: 0o700 });
  let exists = true;
  try { await access(cert); await access(key); } catch { exists = false; }
  if (!exists) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
      '-subj', '/CN=Ping Presenca local mail test', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout', key, '-out', cert], { stdio: 'ignore' });
  }
  try { execFileSync('openssl', ['x509', '-checkend', '0', '-noout', '-in', cert], { stdio: 'ignore' }); }
  catch { throw new Error('Certificado local vencido. Pare o Mailpit e remova somente .local/mailpit/certs para regenerar; mensagens ficam em data.'); }
  compose('up', '-d');
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch('http://127.0.0.1:18025/livez', { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        console.log('Caixa de teste: http://127.0.0.1:18025 — apenas local, sem entrega externa.');
        return;
      }
    } catch { /* container starting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Mailpit não ficou disponível na porta 18025. Confira Docker e conflitos de portas.');
}

async function child(command, args, env) {
  const task = spawn(command, args, { cwd: root, env, stdio: 'inherit', detached: true });
  const stop = () => { try { process.kill(-task.pid, 'SIGTERM'); } catch { /* already stopped */ } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = await new Promise((resolve, reject) => { task.once('error', reject); task.once('exit', code => resolve(code ?? 0)); });
    process.exitCode = result;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}

export async function main(action = process.argv[2]) {
  if (!['up', 'stop', 'dev', 'tunnel', 'check'].includes(action)) throw new Error('Use up, stop, dev, tunnel ou check.');
  if (action === 'stop') { compose('stop'); return; }
  if (process.platform === 'win32') throw new Error('Use Linux, macOS ou WSL.');
  // Read only: never persist SMTP credentials or rewrite the existing .env.
  const { config } = await import('dotenv');
  const env = { ...process.env };
  config({ path: join(root, '.env'), processEnv: env, quiet: true });
  const local = mailEnvironment(env);
  await start();
  if (action === 'up') return;
  if (action === 'check') {
    await child(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import {createMailSender} from './backend/src/identity/mail.ts';
      import {parseConfig} from './backend/src/config.ts';
      await createMailSender(parseConfig(process.env))({to:'teste@example.com',url:'http://localhost:5173/#teste-smtp',installationName:'Teste local — não é convite real'});
      console.log('Mensagem sintética enviada com TLS. Abra a caixa local; não contém convite ou credencial real.');
    `], local);
    return;
  }
  if (action === 'dev') Object.assign(local, { PUBLIC_ORIGIN: 'http://localhost:5173', COOKIE_SECURE: 'false', API_HOST: '127.0.0.1', API_PORT: '3000', API_PROXY_URL: 'http://127.0.0.1:3000' });
  console.log('Não migra nem modifica o banco. Pare o dev anterior antes de iniciar este comando.');
  await child('npm', ['run', action === 'tunnel' ? 'dev:tunnel' : 'dev', '--registry=https://registry.npmmirror.com'], local);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error('Falha no ambiente de e-mail local. Confira Docker, OpenSSL, portas 18025/11025 e certificado. Nenhuma configuração da aplicação foi sobrescrita.'); process.exitCode = 1; });
}
