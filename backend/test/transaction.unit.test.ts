import test from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { transaction } from '../src/db/pool.js';

// Doubles verify orchestration only; atomicity/constraints need real PostgreSQL tests.
function fixture(failOn?: string) {
  const calls: string[] = [];
  const failure = new Error('synthetic database failure');
  const client = {
    async query(sql: string) {
      calls.push(sql);
      if (sql === failOn) throw failure;
      return { rows: [] };
    },
    release() { calls.push('RELEASE'); },
  } as unknown as pg.PoolClient;
  const pool = { async connect() { calls.push('CONNECT'); return client; } } as unknown as pg.Pool;
  return { pool, client, calls, failure };
}

test('Transação: retorna resultado somente após COMMIT e libera conexão', async () => {
  const f = fixture();
  const result = await transaction(f.pool, async (client) => {
    assert.equal(client, f.client);
    await client.query('WORK');
    return { id: 'synthetic' };
  });
  assert.deepEqual(result, { id: 'synthetic' });
  assert.deepEqual(f.calls, ['CONNECT', 'BEGIN', 'WORK', 'COMMIT', 'RELEASE']);
});

test('A54 parcial: falha durante trabalho solicita ROLLBACK, não COMMIT, e libera conexão', async () => {
  const f = fixture('AUDIT');
  await assert.rejects(transaction(f.pool, async (c) => {
    await c.query('STATE');
    await c.query('AUDIT');
  }), (e) => e === f.failure);
  assert.deepEqual(f.calls, ['CONNECT', 'BEGIN', 'STATE', 'AUDIT', 'ROLLBACK', 'RELEASE']);
});

test('Transação: falha no COMMIT não retorna sucesso e ainda libera conexão', async () => {
  const f = fixture('COMMIT');
  await assert.rejects(transaction(f.pool, async () => 'result'), (e) => e === f.failure);
  assert.deepEqual(f.calls, ['CONNECT', 'BEGIN', 'COMMIT', 'ROLLBACK', 'RELEASE']);
});

test('Transação: falha no ROLLBACK ainda libera a conexão', async () => {
  const f = fixture('ROLLBACK');
  await assert.rejects(transaction(f.pool, async () => { throw new Error('work failed'); }));
  assert.deepEqual(f.calls, ['CONNECT', 'BEGIN', 'ROLLBACK', 'RELEASE']);
});

test('Transação: conexão indisponível não inicia o trabalho', async () => {
  const unavailable = new Error('connection unavailable');
  const pool = { async connect() { throw unavailable; } } as unknown as pg.Pool;
  let worked = false;
  await assert.rejects(transaction(pool, async () => { worked = true; }), (e) => e === unavailable);
  assert.equal(worked, false);
});
