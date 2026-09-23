import test from 'node:test';
import assert from 'node:assert/strict';
import { tunnelOrigin, tunnelEnvironment } from './dev-tunnel.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('accepts only a started HTTPS tunnel, not arbitrary log URLs', () => {
  assert.equal(tunnelOrigin(JSON.stringify({ msg: 'started tunnel', url: 'https://demo.ngrok-free.dev' })), 'https://demo.ngrok-free.dev');
  for (const line of ['invalid', '{}', JSON.stringify({ msg: 'other', url: 'https://demo.test' }),
    ...['http://demo.test', 'https://user:pass@demo.test', 'https://demo.test/path', 'https://demo.test/?secret=x'].map(url => JSON.stringify({ msg: 'started tunnel', url }))]) {
    assert.equal(tunnelOrigin(line), null);
  }
});

test('temporary environment keeps database config but enforces secure origin and exact Vite host', () => {
  const old = { DATABASE_URL: 'synthetic', PUBLIC_ORIGIN: 'http://localhost:5173', COOKIE_SECURE: 'false', API_PORT: '9000' };
  const env = tunnelEnvironment('https://demo.ngrok-free.dev', old);
  assert.equal(env.DATABASE_URL, 'synthetic');
  assert.equal(env.PUBLIC_ORIGIN, 'https://demo.ngrok-free.dev');
  assert.equal(env.COOKIE_SECURE, 'true');
  assert.equal(env.API_PORT, '3000');
  assert.equal(env.API_PROXY_URL, 'http://127.0.0.1:3000');
  assert.equal(env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS, 'demo.ngrok-free.dev');
  assert.equal(old.COOKIE_SECURE, 'false');
  assert.throws(() => tunnelEnvironment('http://demo.test'));
});

test('launcher starts local services and cleans up on SIGTERM without a real public tunnel', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ping-tunnel-test-'));
  let child;
  try {
    await writeFile(join(directory, 'ngrok'), `#!${process.execPath}\nconsole.log(JSON.stringify({msg:'started tunnel',url:'https://synthetic.ngrok-free.dev'}));setInterval(()=>{},1000);`, { mode: 0o700 });
    await writeFile(join(directory, 'npm'), `#!${process.execPath}\nconst http=require('node:http');http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({status:'ok'}))}).listen(5173,'127.0.0.1');`, { mode: 0o700 });
    child = spawn(process.execPath, ['scripts/dev-tunnel.mjs', '--yes'], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    let output = '';
    const ready = new Promise((resolve, reject) => {
      child.stdout.on('data', (data) => {
        output += data;
        if (output.includes('Aplicação local pronta')) resolve();
      });
      child.once('exit', () => reject(new Error(`Launcher exited early: ${output}`)));
    });
    await Promise.race([ready, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timeout')), 8000);
      timer.unref();
    })]);
    child.kill('SIGTERM');
    assert.equal((await exited)[0], 0);
    await assert.rejects(fetch('http://127.0.0.1:5173/api/health', { signal: AbortSignal.timeout(1000) }));
  } finally {
    if (child && child.exitCode === null) {
      const exit = once(child, 'exit');
      child.kill('SIGTERM');
      await exit;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
