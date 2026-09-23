import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type pg from 'pg';

export async function migrationManifest() {
  const directory = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(f => /^\d{3}_[a-z_]+\.sql$/.test(f)).sort();
  return Promise.all(files.map(async name => {
    const sql = await readFile(new URL(name, directory), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

export async function migrate(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(720261001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    const manifest = await migrationManifest();
    const files = manifest.map(m => m.name);
    const existing = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations ORDER BY name');
    for (const row of existing.rows) if (!files.includes(row.name)) throw new Error('Migration aplicada ausente no código');
    for (const { name, sql, checksum } of manifest) {
      const old = existing.rows.find(row => row.name === name);
      if (old && old.checksum !== checksum) throw new Error(`Migration alterada após aplicação: ${name}`);
      if (old) continue;
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [name, checksum]);
      applied.push(name);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
