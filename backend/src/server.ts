import './platform/env.js';
import { parseConfig } from './config.js';
import { createPool } from './db/pool.js';
import { initializeInstallation } from './installation.js';
import { buildApp } from './app.js';
import { assertSchemaReady } from './db/readiness.js';
import { AppError } from './platform/errors.js';
import { startAttendanceWorker } from './attendance/worker.js';

const config = parseConfig(process.env);
const pool = createPool(config);
try {
  await assertSchemaReady(pool);
  await initializeInstallation(pool, config);
  const app = await buildApp(config, pool, { logger: true });
  let stopAttendance = async () => {};
  app.addHook('onListen', async () => {
    stopAttendance = startAttendanceWorker(pool, () =>
      app.log.error('Falha ao consolidar chamadas expiradas; nova tentativa será realizada.'),
    );
  });
  app.addHook('onClose', async () => {
    await stopAttendance();
    await pool.end();
  });
  const stop = () => {
    void app.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  // Startup errors must not print DATABASE_URL/credentials.
  console.error(
    error instanceof AppError ||
      (error instanceof Error && error.message.startsWith('INSTALLATION_TIME_ZONE'))
      ? error.message
      : 'Falha ao iniciar. Confira a configuração, PostgreSQL e execute as migrations.',
  );
  await pool.end();
  process.exitCode = 1;
}
