import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { createInterface as prompt } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export function tunnelOrigin(line) {
  try {
    const event = JSON.parse(line);
    if (event.msg !== 'started tunnel') return null;
    const url = new URL(event.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      return null;
    return url.origin;
  } catch { return null; }
}

export function tunnelEnvironment(origin, current = process.env) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('Origem HTTPS inválida.');
  return {
    ...current,
    NODE_ENV: 'development',
    PUBLIC_ORIGIN: origin,
    COOKIE_SECURE: 'true',
    API_HOST: '127.0.0.1',
    API_PORT: '3000',
    API_PROXY_URL: 'http://127.0.0.1:3000',
    __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: url.hostname,
    npm_config_registry: 'https://registry.npmmirror.com',
  };
}

async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Porta ${port} ocupada. Pare o dev/ngrok existente antes de continuar.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

export async function main() {
  if (process.platform === 'win32') throw new Error('Execute este script no Linux, macOS ou WSL.');
  console.log('Este teste expõe a aplicação e os dados do .env à internet através do ngrok.');
  console.log('Use contas/turmas de teste. Login e HTTPS permanecem obrigatórios. Ctrl+C encerra tudo que este script iniciar.');
  if (!process.argv.includes('--yes')) {
    if (!process.stdin.isTTY) throw new Error('Confirme em terminal interativo ou use --yes para autorizar explicitamente.');
    const question = prompt({ input: process.stdin, output: process.stdout });
    try {
      if ((await question.question('Autoriza expor temporariamente esta instalação? Digite sim: ')).trim().toLowerCase() !== 'sim') return;
    } finally { question.close(); }
  }
  for (const port of [3000, 5173, 4040]) await requireFreePort(port);
  const children = [];
  let stopping = false;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
    }
    // Kill only the process groups created here, including npm/watch descendants.
    setTimeout(() => {
      for (const child of children) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already stopped */ }
      }
      finish();
    }, 1500);
  };
  const interrupt = () => stop(0);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  function start(command, args, options) {
    const child = spawn(command, args, { cwd: root, detached: true, ...options });
    children.push(child);
    child.once('error', () => {
      console.error(`Não foi possível iniciar ${command}. Confira instalação e configuração.`);
      stop(1);
    });
    child.once('exit', () => { if (!stopping) { console.error(`${command} encerrou; fechando o teste.`); stop(1); } });
    return child;
  }
  try {
    let origin;
    const tunnel = start('ngrok', ['http', 'http://127.0.0.1:5173', '--inspect=false', '--log=stdout', '--log-format=json'],
      { stdio: ['ignore', 'pipe', 'inherit'] });
    const lines = createInterface({ input: tunnel.stdout });
    lines.on('line', (line) => { origin ??= tunnelOrigin(line); });
    const deadline = Date.now() + 45000;
    while (!origin && !stopping && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    if (!stopping && !origin) throw new Error('Ngrok não conectou em 45s. Confira autenticação, rede/VPN e certificados.');
    if (stopping) return await done;
    start('npm', ['run', 'dev', '--registry=https://registry.npmmirror.com'],
      { stdio: 'inherit', env: tunnelEnvironment(origin) });
    let ready = false;
    const readyDeadline = Date.now() + 45000;
    while (!stopping && Date.now() < readyDeadline) {
      try {
        const response = await fetch('http://127.0.0.1:5173/api/health', { signal: AbortSignal.timeout(1000) });
        ready = response.ok && (await response.json()).status === 'ok';
      } catch { /* service starting */ }
      if (ready) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!stopping && !ready) throw new Error('Aplicação não ficou pronta. Confira PostgreSQL e migrations; este script não migra nem apaga dados.');
    if (!stopping) {
      console.log(`\nAplicação local pronta. Abra no computador E no celular:\n${origin}\n`);
      console.log('QR e convites usarão essa origem. O acesso externo depende da rede/ngrok.');
      console.log('Se aparecer aviso do ngrok, confira o endereço antes de Visit Site. Ctrl+C encerra túnel e aplicação; PostgreSQL permanece ativo.');
    }
    await done;
  } catch (error) {
    console.error(error.message);
    stop(1);
    await done;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
