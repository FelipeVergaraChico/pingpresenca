import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const ROTATION_MS = 30_000;
export const AUTHORIZATION_MS = 60_000;
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function challenge(seed: string, now: number) {
  const window = Math.floor(now / ROTATION_MS);
  const mac = (purpose: string) =>
    createHmac('sha256', seed).update(`${purpose}:${window}`).digest();
  return {
    code: String(mac('code').readUInt32BE(0) % 1_000_000).padStart(6, '0'),
    qr: mac('qr').toString('base64url'),
    rotatesAt: (window + 1) * ROTATION_MS,
  };
}
export function matches(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
export type GeoInput =
  | {
      status: 'AVAILABLE';
      latitude: number;
      longitude: number;
      accuracy: number;
    }
  | { status: 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' };
export type Policy = {
  latitude: number;
  longitude: number;
  radius: number;
  geoRequired: boolean;
  precisionRule: string;
  name: string;
};
export function distanceMeters(lat: number, lon: number, otherLat: number, otherLon: number) {
  const rad = (n: number) => (n * Math.PI) / 180;
  const a =
    Math.sin(rad(otherLat - lat) / 2) ** 2 +
    Math.cos(rad(lat)) * Math.cos(rad(otherLat)) * Math.sin(rad(otherLon - lon) / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
}
export function precisionOutcome(d: number, accuracy: number, radius: number) {
  return d + accuracy <= radius ? 'ACCEPTED' : d - accuracy > radius ? 'REJECTED' : 'PENDING';
}
export function evaluateGeo(policy: Policy, geo: GeoInput) {
  if (!policy.geoRequired)
    return {
      outcome: 'ACCEPTED',
      reason: 'VALIDATED',
      distance: null,
      accuracy: null,
    } as const;
  if (geo.status !== 'AVAILABLE')
    return {
      outcome: 'PENDING',
      reason: `LOCATION_${geo.status}`,
      distance: null,
      accuracy: null,
    } as const;
  const distance = distanceMeters(policy.latitude, policy.longitude, geo.latitude, geo.longitude);
  const outcome = precisionOutcome(distance, geo.accuracy, policy.radius);
  return {
    outcome,
    reason:
      outcome === 'ACCEPTED'
        ? 'VALIDATED'
        : outcome === 'REJECTED'
          ? 'OUTSIDE_RADIUS'
          : 'INSUFFICIENT_ACCURACY',
    distance,
    accuracy: geo.accuracy,
  };
}
export const reasons: Record<string, string> = {
  VALIDATED: 'Presença confirmada.',
  OUTSIDE_RADIUS: 'Posição fora do raio permitido.',
  INSUFFICIENT_ACCURACY: 'Localização com precisão insuficiente.',
  LOCATION_DENIED: 'Permissão de localização negada.',
  LOCATION_UNAVAILABLE: 'Localização não pôde ser validada.',
  LOCATION_TIMEOUT: 'Tempo esgotado ao obter a localização.',
  MANUAL_PROTECTED: 'Existe uma decisão manual. Procure o professor para uma correção.',
  AUTO_CLOSE: 'Ausência registrada no fechamento da chamada.',
};
export function frequency(
  rows: { attendance_mode: string; status: string | null; included: boolean; cancelled?: boolean; reopened?: boolean }[],
) {
  return ['PILOT', 'OFFICIAL'].map((mode) => {
    const relevant = rows.filter((r) => r.attendance_mode === mode && !r.cancelled);
    const counted = relevant.filter((r) => r.included);
    const present = counted.filter((r) => r.status === 'PRESENT').length;
    const absent = counted.filter((r) => r.status === 'ABSENT').length;
    const pending = relevant.filter((r) => r.status === 'PENDING').length;
    return {
      mode,
      present,
      absent,
      pending,
      provisional: pending > 0 || counted.some((r) => r.reopened),
      percent: present + absent ? (present / (present + absent)) * 100 : null,
    };
  });
}
