import '../platform/env.js';
import { parseConfig } from '../config.js';
import { createPool } from './pool.js';
import { migrate } from './migrate.js';

const pool = createPool(parseConfig(process.env));
try { console.log({ applied: await migrate(pool) }); }
catch { console.error('Falha na migration. Verifique configuração/conectividade e o histórico de migrations.'); process.exitCode = 1; }
finally { await pool.end(); }
