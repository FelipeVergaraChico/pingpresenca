import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLessonList } from '../src/academic/lesson-list.js';
import { AppError } from '../src/platform/errors.js';

test('Listagem: padrões limitam a página e não ativam calendário implicitamente', () => {
  assert.deepEqual(parseLessonList({}), { page: 1, pageSize: 10, view: 'list', scope: 'all' });
});

test('Listagem: aceita limites, filtros e dia bissexto válidos', () => {
  assert.deepEqual(parseLessonList({ page: '1000000', pageSize: '50', scope: 'past',
    mode: 'PILOT', status: 'PENDING', from: '2028-02-29', to: '2028-02-29' }), {
    page: 1000000, pageSize: 50, view: 'list', scope: 'past', mode: 'PILOT',
    status: 'PENDING', from: '2028-02-29', to: '2028-02-29',
  });
});

for (const [field, value] of [
  ['page', '0'], ['page', '-1'], ['page', '1.5'], ['page', '1e2'], ['page', '1000001'],
  ['page', ['1', '2']], ['pageSize', '51'], ['pageSize', '0'], ['pageSize', ''],
  ['from', '2026-02-29'], ['from', '0000-01-01'], ['to', '2026-09-30T00:00:00Z'],
  ['month', '0000-01'], ['month', '2026-13'], ['scope', 'invalid'],
  ['mode', 'invalid'], ['status', 'invalid'], ['view', 'invalid'],
] as const) {
  test(`Listagem/A83 parcial: rejeita ${field}=${JSON.stringify(value)} com erro de campo`, () => {
    assert.throws(() => parseLessonList({ [field]: value }), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'INVALID_LIST_FILTERS');
      assert.equal(error.fieldErrors[0]?.field, field);
      return true;
    });
  });
}

test('Listagem: intervalo invertido é rejeitado; filtros desconhecidos não refletem valores', () => {
  assert.throws(() => parseLessonList({ from: '2026-10-01', to: '2026-09-30' }),
    (e: unknown) => e instanceof AppError && e.fieldErrors[0]?.field === 'to');
  assert.throws(() => parseLessonList({ privateInput: 'sensitive-value' }), (e: unknown) => {
    assert.ok(e instanceof AppError);
    assert.equal(JSON.stringify(e).includes('sensitive-value'), false);
    assert.equal(JSON.stringify(e).includes('privateInput'), false);
    return true;
  });
});

test('Calendário: exige habilitação explícita da rota; histórico não aceita esse formato', () => {
  assert.throws(() => parseLessonList({ view: 'calendar', month: '2026-09' }),
    { status: 400, code: 'INVALID_LIST_FILTERS' });
  assert.equal(parseLessonList({ view: 'calendar', month: '2026-09' }, true).month, '2026-09');
  assert.equal(parseLessonList({ view: 'calendar' }, true).month, undefined);
});
