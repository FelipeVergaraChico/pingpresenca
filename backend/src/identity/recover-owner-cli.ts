import '../platform/env.js';
import { parseArgs } from 'node:util';
import { parseConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { assertSchemaReady } from '../db/readiness.js';
import { recoverOwner } from './recovery.js';

let pool;
try {
  const { values } = parseArgs({ options: { reason: { type: 'string' } }, strict: true, allowPositionals: false });
  if (!values.reason || values.reason.trim().length < 3) throw new Error('Use --reason com uma justificativa de pelo menos 3 caracteres. Não informe uma senha.');
  const config = parseConfig({ ...process.env, BOOTSTRAP_SECRET: undefined });
  pool = createPool(config);
  await assertSchemaReady(pool);
  const result = await recoverOwner(pool, config.publicOrigin, values.reason);
  console.log('Link confidencial, válido por até 15 minutos. Entregue somente ao owner; não copie para logs ou repositório.');
  console.log(result.url);
} catch (error) {
  console.error(error instanceof Error && ('status' in error || error.message.startsWith('Use --reason')) ? error.message : 'Falha na recuperação. Verifique banco, migrations e configuração; nenhum owner novo foi criado.');
  process.exitCode = 1;
} finally { await pool?.end(); }
