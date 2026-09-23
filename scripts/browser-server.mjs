import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const name = `pingpresenca-e0-browser-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const children = [];
let created = false;
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  if (created) {
    try { docker('rm', '-f', '-v', name); }
    catch {
      console.error(`Não foi possível remover o container de teste ${name}. Quando o Docker estiver disponível, execute: docker rm -f -v ${name}`);
      process.exitCode = 1;
    }
  }
  process.exit();
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
try {
  docker('run', '-d', '--name', name, '-e', 'POSTGRES_USER=pingtest', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=pingpresenca_test_browser', '-p', '127.0.0.1::5432', 'postgres:16-alpine');
  created = true;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { docker('exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'pingtest'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  if (!ready) throw new Error('PostgreSQL indisponível');
  const port = docker('port', name, '5432/tcp').split(':').at(-1);
  const env = { ...process.env, NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: '3105',
    API_PROXY_URL: 'http://127.0.0.1:3105', PUBLIC_ORIGIN: 'http://localhost:5175', COOKIE_SECURE: 'false',
    INSTALLATION_NAME: 'Comunidade de aprendizagem', INSTALLATION_TIME_ZONE: 'America/Sao_Paulo',
    BOOTSTRAP_SECRET: 'e0-browser-synthetic-secret-never-use-in-production',
    DATABASE_URL: `postgresql://pingtest:${password}@127.0.0.1:${port}/pingpresenca_test_browser` };
  execFileSync(process.execPath, ['--import', 'tsx', 'backend/src/db/migrate-cli.ts'], { env, stdio: 'inherit' });
  children.push(spawn(process.execPath, ['--import', 'tsx', 'backend/src/server.ts'], { env, stdio: 'inherit' }));
  children.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'frontend', '--host', '127.0.0.1', '--port', '5175'], { env, stdio: 'inherit' }));
  for (const child of children) child.on('exit', () => {
    if (!stopping) { process.exitCode = 1; stop(); }
  });
} catch {
  console.error('Falha ao preparar ambiente de navegador. Verifique Docker e portas 3105/5175.');
  process.exitCode = 1;
  stop();
}
