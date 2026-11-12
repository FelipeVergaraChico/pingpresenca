import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRecurrence, recurrenceSchema } from '../src/academic/recurrence.js';
const rule = () => recurrenceSchema.parse({ from: '2026-10-01', until: '2026-10-15', weekdays: [2, 4], starts: '19:00', ends: '21:00', title: 'Programação', locationId: '10000000-0000-4000-8000-000000000001', attendanceMode: 'PILOT' });
test('A25/A80: dias inclusivos e horário no fuso da instituição', () => {
  const rows = expandRecurrence(rule(), 'America/Sao_Paulo');
  assert.equal(rows.length, 5);
  assert.equal(rows[0]!.startsAt, '2026-10-01T22:00:00Z');
  assert.equal(rows[4]!.startsAt, '2026-10-15T22:00:00Z');
});
test('A80: término no dia seguinte inclusive após o último dia do período', () => {
  const rows = expandRecurrence({ ...rule(), from: '2026-12-31', until: '2026-12-31', starts: '23:00', ends: '01:00' }, 'America/Sao_Paulo');
  assert.equal(rows[0]!.endsAt, '2027-01-01T04:00:00Z');
});
test('A80: rejeita datas impossíveis, período excessivo, vazio e horário igual', () => {
  for (const patch of [{ from: '2026-02-30' }, { until: '2028-01-01' }, { from: '2026-10-02', until: '2026-10-02' }, { ends: '19:00' }])
    assert.throws(() => expandRecurrence({ ...rule(), ...patch }, 'UTC'));
});
test('A80: horário inexistente ou ambíguo reprova todo o lote', () => {
  assert.throws(() => expandRecurrence({ ...rule(), from: '2026-03-08', until: '2026-03-08', weekdays: [0], starts: '02:30', ends: '04:00' }, 'America/New_York'));
  assert.throws(() => expandRecurrence({ ...rule(), from: '2026-11-01', until: '2026-11-01', weekdays: [0], starts: '01:30', ends: '04:00' }, 'America/New_York'));
});
test('D04: dias duplicados/fora de ordem são normalizados', () => {
  assert.deepEqual(recurrenceSchema.parse({ ...rule(), weekdays: [4, 2, 4] }).weekdays, [2, 4]);
});
