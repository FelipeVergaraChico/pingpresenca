import type pg from 'pg';
import type { Config } from './config.js';

export async function initializeInstallation(pool: pg.Pool, config: Config) {
  await pool.query(`INSERT INTO installation(singleton, name, time_zone) VALUES (true, $1, $2)
    ON CONFLICT (singleton) DO NOTHING`, [config.installationName, config.timeZone]);
  const { rows: [row] } = await pool.query<{ time_zone: string }>('SELECT time_zone FROM installation WHERE singleton');
  if (row?.time_zone !== config.timeZone) throw new Error('INSTALLATION_TIME_ZONE diverge do fuso persistido. Nenhum histórico foi alterado.');
}

export async function installationStatus(pool: pg.Pool) {
  const { rows: [row] } = await pool.query(`SELECT name, time_zone, bootstrap_completed_at,
    EXISTS (SELECT 1 FROM account_roles WHERE role = 'OWNER') AS has_owner,
    clock_timestamp() AS server_time FROM installation WHERE singleton`);
  if (!row) throw new Error('Instalação não inicializada');
  return {
    name: row.name as string, timeZone: row.time_zone as string,
    initialized: Boolean(row.bootstrap_completed_at || row.has_owner),
    serverTime: (row.server_time as Date).toISOString(),
  };
}
