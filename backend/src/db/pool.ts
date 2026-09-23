import pg from 'pg';
import type { Config } from '../config.js';
export function createPool(config: Config) {
  return new pg.Pool({ ...config.database, max: 10, connectionTimeoutMillis: 5000,
    statement_timeout: 10000, options: '-c timezone=UTC', application_name: 'ping-presenca' });
}

export async function transaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
