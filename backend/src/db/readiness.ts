import type pg from 'pg';
import { AppError } from '../platform/errors.js';
import { migrationManifest } from './migrate.js';

// Read-only: startup/health never migrate, repair checksums or print connection details.
export async function assertSchemaReady(pool: pg.Pool) {
  const expected = await migrationManifest();
  let applied: { name: string; checksum: string }[];
  try {
    applied = (await pool.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations ORDER BY name',
    )).rows;
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '42P01') {
      throw schemaError();
    }
    throw new AppError(503, 'DATABASE_UNAVAILABLE', 'PostgreSQL indisponível. Verifique o serviço e a configuração da conexão.');
  }
  if (expected.length === 0 || applied.length !== expected.length || expected.some(
    migration => !applied.some(row => row.name === migration.name && row.checksum === migration.checksum),
  )) throw schemaError();
}

function schemaError() {
  return new AppError(503, 'SCHEMA_NOT_READY',
    'Banco incompatível com esta versão. Confira as migrations; antes de atualizar, suspenda escritas e faça backup. Execute npm run db:migrate e reinicie a API. Não altere migrations já aplicadas.');
}
