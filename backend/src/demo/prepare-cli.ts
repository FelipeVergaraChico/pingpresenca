import '../platform/env.js';
import { parseConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { assertSchemaReady } from '../db/readiness.js';
import { initializeInstallation } from '../installation.js';
import { prepareDemo } from './service.js';
import { AppError } from '../platform/errors.js';

const config = parseConfig(process.env);
const pool = createPool(config);
try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--replace-demo-data')) throw new Error('Argumento inválido.');
  await assertSchemaReady(pool);
  await initializeInstallation(pool, config);
  const result = await prepareDemo(pool, config, args.includes('--replace-demo-data'));
  console.log(`Demonstração preparada até ${result.expiresAt}. Se houve restauração, os dados fictícios anteriores foram apagados e não são recuperáveis sem backup próprio.`);
} catch (error) {
  console.error(error instanceof AppError ? error.message : 'Falha ao preparar demonstração. Confira configuração e migrations.');
  process.exitCode = 1;
} finally { await pool.end(); }
