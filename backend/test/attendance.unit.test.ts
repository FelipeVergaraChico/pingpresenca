import test from 'node:test';
import assert from 'node:assert/strict';
import {
  challenge,
  distanceMeters,
  evaluateGeo,
  frequency,
  matches,
  precisionOutcome,
} from '../src/attendance/domain.js';
test('A45/A46: conservative precision boundaries', () => {
  for (const [d, a, r, outcome] of [
    [60, 20, 100, 'ACCEPTED'],
    [140, 20, 100, 'REJECTED'],
    [90, 30, 100, 'PENDING'],
    [80, 20, 100, 'ACCEPTED'],
    [120, 20, 100, 'PENDING'],
  ] as const)
    assert.equal(precisionOutcome(d, a, r), outcome);
  assert.equal(distanceMeters(-23, -46, -23, -46), 0);
  assert(distanceMeters(0, 0, 0, 1) > 111000);
});
test('A47/A75: unavailable location has no fabricated evidence; optional policy ignores coordinates', () => {
  const policy = {
    latitude: 0,
    longitude: 0,
    radius: 100,
    geoRequired: true,
    precisionRule: 'CONSERVATIVE_V1',
    name: 'Room',
  };
  for (const status of ['DENIED', 'UNAVAILABLE', 'TIMEOUT'] as const)
    assert.deepEqual(evaluateGeo(policy, { status }), {
      outcome: 'PENDING',
      reason: `LOCATION_${status}`,
      distance: null,
      accuracy: null,
    });
  assert.deepEqual(
    evaluateGeo(
      { ...policy, geoRequired: false },
      { status: 'AVAILABLE', latitude: 10, longitude: 20, accuracy: 1000 },
    ),
    {
      outcome: 'ACCEPTED',
      reason: 'VALIDATED',
      distance: null,
      accuracy: null,
    },
  );
});
test('A81: challenge rotates at the exact boundary and depends on opening secret', () => {
  const a = challenge('secret-a', 29999),
    b = challenge('secret-a', 30000);
  assert.notEqual(a.qr, b.qr);
  assert.notEqual(a.qr, challenge('secret-b', 29999).qr);
  assert.equal(a.rotatesAt, 30000);
  assert.match(a.code, /^\d{6}$/);
  assert(matches(a.code, a.code));
  assert(!matches(a.qr, b.qr));
});
test('A63/A64/A66/A67/A69: only closed lessons contribute; pending is provisional; modes separate', () => {
  const row = (status: string, mode = 'OFFICIAL', included = true) => ({
    status,
    attendance_mode: mode,
    included,
  });
  const rows = [
    row('PRESENT'),
    row('PRESENT'),
    row('PRESENT'),
    row('ABSENT'),
    row('PENDING'),
    row('PRESENT', 'PILOT'),
    row('ABSENT', 'OFFICIAL', false),
  ];
  assert.equal(frequency(rows)[1]!.percent, 75);
  assert(frequency(rows)[1]!.provisional);
  assert.equal(frequency(rows)[0]!.percent, 100);
  assert.equal(frequency([...rows.slice(0, 4), row('ABSENT')])[1]!.percent, 60);
  assert.equal(frequency([...rows.slice(0, 4), row('PRESENT')])[1]!.percent, 80);
  assert.equal(frequency([])[1]!.percent, null);
  assert.equal(frequency([row('ABSENT')])[1]!.percent, 0);
});

test('A81/A42 parcial: desafio é estável na janela, textual e separado por propósito', () => {
  const first = challenge('synthetic-seed', 0);
  assert.deepEqual(challenge('synthetic-seed', 29999), first);
  assert.match(first.qr, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(matches(first.qr, first.code), false);
  // Procura determinística de um vetor com dois zeros iniciais, sem depender do relógio.
  const vector = Array.from({ length: 2000 }, (_, i) => challenge('synthetic-seed', i * 30000))
    .find((c) => c.code.startsWith('00'));
  assert.ok(vector);
  assert.equal(vector.code.length, 6);
  assert.equal(matches(vector.code, String(Number(vector.code))), false);
});

test('A45/A75 parcial: avaliação integrada retorna motivos e somente evidência derivada', () => {
  const policy = { latitude: 0, longitude: 0, radius: 100, geoRequired: true,
    precisionRule: 'CONSERVATIVE_V1', name: 'Sala sintética' };
  for (const [longitude, accuracy, outcome, reason] of [
    [0, 20, 'ACCEPTED', 'VALIDATED'],
    [0.002, 10, 'REJECTED', 'OUTSIDE_RADIUS'],
    [0, 101, 'PENDING', 'INSUFFICIENT_ACCURACY'],
  ] as const) {
    const result = evaluateGeo(policy, { status: 'AVAILABLE', latitude: 0, longitude, accuracy });
    assert.equal(result.outcome, outcome);
    assert.equal(result.reason, reason);
    assert.equal(result.accuracy, accuracy);
    assert.equal(typeof result.distance, 'number');
    assert.deepEqual(Object.keys(result).sort(), ['accuracy', 'distance', 'outcome', 'reason']);
  }
});

test('Geometria: antimeridiano usa caminho curto e antípodas produzem distância finita', () => {
  const d = distanceMeters(0, 179.999, 0, -179.999);
  assert.ok(d > 222 && d < 223);
  assert.equal(d, distanceMeters(0, -179.999, 0, 179.999));
  assert.ok(Math.abs(distanceMeters(0, 0, 0, 180) - Math.PI * 6371000) < 0.001);
});

test('A44: política opcional ignora todos os estados de indisponibilidade', () => {
  const policy = { latitude: 0, longitude: 0, radius: 100, geoRequired: false,
    precisionRule: 'CONSERVATIVE_V1', name: 'Sala' };
  for (const status of ['DENIED', 'TIMEOUT', 'UNAVAILABLE'] as const)
    assert.deepEqual(evaluateGeo(policy, { status }), {
      outcome: 'ACCEPTED', reason: 'VALIDATED', distance: null, accuracy: null,
    });
});

test('A67/A70: cancelamento remove contagens e provisoriedade; reabertura só conta após fechamento', () => {
  const row = { attendance_mode: 'OFFICIAL', status: 'PRESENT', included: true };
  assert.deepEqual(frequency([{ ...row, cancelled: true, reopened: true },
    { ...row, cancelled: true, status: 'PENDING' }])[1], {
    mode: 'OFFICIAL', present: 0, absent: 0, pending: 0, provisional: false, percent: null,
  });
  assert.equal(frequency([{ ...row, reopened: true, included: false }])[1]!.provisional, false);
  assert.equal(frequency([{ ...row, reopened: true }])[1]!.provisional, true);
  assert.equal(frequency([row])[1]!.provisional, false);
});

test('A66/A69: pendência não vira zero e não contamina outro modo; ausência de registro não é falta', () => {
  const rows = [
    { attendance_mode: 'PILOT', status: 'PENDING', included: false },
    { attendance_mode: 'OFFICIAL', status: null, included: true },
  ];
  const [pilot, official] = frequency(rows);
  assert.equal(pilot!.percent, null);
  assert.equal(pilot!.pending, 1);
  assert.equal(pilot!.provisional, true);
  assert.equal(official!.absent, 0);
  assert.equal(official!.percent, null);
  assert.equal(official!.provisional, false);
});
