import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const suffix = randomBytes(6).toString('hex');
const name = `pingpresenca-e0-test-${suffix}`;
const demo = process.argv[2] === 'demo';
const database = `${demo ? 'pingpresenca_demo_test_' : 'pingpresenca_test_'}${suffix}`;
const password = randomBytes(24).toString('hex');
const suite = demo ? 'test:demo:integration' : process.argv[2] === 'e3' ? 'test:pilot' : 'test:integration';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let created = false;
try {
  docker('run', '-d', '--name', name, '-e', 'POSTGRES_USER=pingtest', '-e', `POSTGRES_PASSWORD=${password}`, '-e', `POSTGRES_DB=${database}`, '-p', '127.0.0.1::5432', 'postgres:16-alpine');
  created = true;
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try { docker('exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'pingtest', '-d', database); ready = true; break; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  if (!ready) throw new Error('PostgreSQL de teste não iniciou');
  const port = docker('port', name, '5432/tcp').split(':').at(-1);
  console.log('PostgreSQL isolado iniciado; executando testes de integração.');
  const child = spawn('npm', ['run', suite, '-w', 'backend', '--registry=https://registry.npmmirror.com'], { stdio: 'inherit', env: {
    ...process.env, NODE_ENV: 'test', PUBLIC_ORIGIN: 'http://localhost:5173', COOKIE_SECURE: 'false',
    PUBLIC_DEMO: 'false',
    INSTALLATION_NAME: 'Instalação de teste', INSTALLATION_TIME_ZONE: 'America/Sao_Paulo',
    BOOTSTRAP_SECRET: randomBytes(32).toString('hex'),
    DATABASE_URL: `postgresql://pingtest:${password}@127.0.0.1:${port}/${database}`,
  } });
  process.exitCode = await new Promise(resolve => child.on('exit', code => resolve(code ?? 1)));
} catch {
  console.error('Falha ao preparar teste isolado. Verifique Docker e disponibilidade de postgres:16-alpine.'); process.exitCode = 1;
} finally {
  // Only the exact randomly named container created above; no user database.
  if (created) { docker('rm', '-f', '-v', name); console.log('Container e volume temporários de teste removidos.'); }
}
