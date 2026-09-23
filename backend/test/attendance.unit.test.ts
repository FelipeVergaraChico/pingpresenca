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
