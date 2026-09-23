import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const project = `pingpresenca-e0-smoke-${randomBytes(5).toString('hex')}`;
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString('hex');
const env = { ...process.env, POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
  NPM_REGISTRY: 'https://registry.npmmirror.com',
  POSTGRES_DB: 'pingpresenca_test_compose', POSTGRES_USER: 'pingtest', POSTGRES_PORT: '0', WEB_PORT: String(port),
  PUBLIC_ORIGIN: origin, COOKIE_SECURE: 'false', INSTALLATION_NAME: 'Teste de instalação E0',
  INSTALLATION_TIME_ZONE: 'America/Sao_Paulo', BOOTSTRAP_SECRET: secret };

async function compose(...args) {
  const child = spawn('docker', ['compose', '--env-file', '/dev/null', '-p', project, ...args], { env, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) throw new Error('Comando de verificação Compose falhou');
}
const json = async (path, body) => {
  const response = await fetch(`${origin}/api${path}`, { method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', Origin: origin } : {}, body: body ? JSON.stringify(body) : undefined });
  return { response, body: await response.json() };
};
async function waitForHttp() {
  for (let attempt=0;attempt<30;attempt++) {
    try { if((await fetch(`${origin}/api/health`,{signal:AbortSignal.timeout(2000)})).ok)return; }
    catch { /* Published HTTP may not be ready when the container starts. */ }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('Frontend/API não respondeu pela porta HTTP publicada do projeto de teste.');
}

try {
  await compose('build');
  await compose('up', '-d', '--wait', 'postgres');
  await compose('run', '--rm', 'migrate');
  await compose('up', '-d', '--wait', 'backend', 'frontend');
  await waitForHttp();
  assert.equal((await fetch(origin)).status, 200);
  assert.equal((await json('/installation')).body.initialized, false);
  const user = { name: 'Teste Compose', email: 'compose@example.com', password: randomBytes(24).toString('hex'), secret };
  assert.equal((await json('/bootstrap', user)).response.status, 201);
  assert.equal((await json('/auth/login', { email: user.email, password: user.password })).response.status, 200);
  // Stop/remove containers only; retain this test project's named database volume.
  await compose('down');
  env.BOOTSTRAP_SECRET = '';
  await compose('up', '-d', '--wait', 'postgres', 'backend', 'frontend');
  await waitForHttp();
  const status = (await json('/installation')).body;
  assert.equal(status.initialized, true); assert.equal(status.timeZone, 'America/Sao_Paulo');
  assert.equal((await json('/bootstrap', user)).response.status, 409);
  assert.equal((await json('/auth/login', { email: user.email, password: user.password })).response.status, 200);
  console.log('E0 Compose: instalação limpa, migration, bootstrap, login e persistência após recriação APROVADOS.');
  // A maintenance window stops every application writer (including its expiration worker).
  // Backup stays in process memory; restore targets a new synthetic database, never the source.
  await compose('stop', 'frontend', 'backend');
  const dbCommand = (args, input) => execFileSync('docker', ['compose', '--env-file', '/dev/null', '-p', project, 'exec', '-T', 'postgres', ...args], { env, input, maxBuffer: 32 * 1024 * 1024 });
  const dump = dbCommand(['pg_dump', '-U', 'pingtest', '-d', env.POSTGRES_DB, '-Fc']);
  assert(dump.length > 0);
  const counts = db => dbCommand(['psql', '-U', 'pingtest', '-d', db, '-Atc', 'SELECT (SELECT count(*) FROM accounts),(SELECT count(*) FROM audit_events),(SELECT count(*) FROM schema_migrations)']).toString().trim();
  const before = counts(env.POSTGRES_DB);
  const restored = 'pingpresenca_test_restored';
  dbCommand(['createdb', '-U', 'pingtest', restored]);
  dbCommand(['pg_restore', '-U', 'pingtest', '-d', restored, '--exit-on-error', '--no-owner'], dump);
  assert.equal(counts(restored), before);
  env.POSTGRES_DB = restored;
  await compose('up', '-d', '--no-deps', '--force-recreate', '--wait', 'backend', 'frontend');
  await waitForHttp();
  assert.equal((await json('/installation')).body.initialized, true);
  assert.equal((await json('/auth/login', { email: user.email, password: user.password })).response.status, 200);
  assert.equal((await json('/bootstrap', user)).response.status, 409);
  console.log('E3 backup/restauração: escritores suspensos, pg_dump -Fc, banco novo restaurado, contagens preservadas, health/login/bootstrap protegido APROVADOS.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha no smoke test'); process.exitCode = 1;
} finally {
  // Deletes only resources of this randomly named test project, never default installation.
  await compose('down', '--volumes', '--remove-orphans');
  console.log('Recursos temporários do teste Compose removidos.');
}
