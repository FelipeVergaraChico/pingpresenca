import { AppError } from '../platform/errors.js';
import { localToInstant } from '../platform/time.js';

export function plannedInstant(local: string, timeZone: string, field?: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local)) {
    throw new AppError(
      400,
      'INVALID_LOCAL_TIME',
      'Informe data e hora no fuso da instituição, sem deslocamento UTC.',
      field
        ? [{ field, message: 'Informe data e hora no fuso da instituição, sem deslocamento UTC.' }]
        : [],
    );
  }
  try {
    return localToInstant(local, timeZone);
  } catch {
    throw new AppError(
      400,
      'INVALID_LOCAL_TIME',
      'Data/hora inválida, ambígua ou inexistente no fuso da instituição.',
      field
        ? [{ field, message: 'Informe uma data/hora válida e inequívoca no fuso da instituição.' }]
        : [],
    );
  }
}
export function eligible(start: string, enrolledAt: string, endedAt: string | null): boolean {
  return (
    Date.parse(enrolledAt) <= Date.parse(start) &&
    (!endedAt || Date.parse(endedAt) > Date.parse(start))
  );
}
export interface LocationPolicy {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  geo_required: boolean;
  precision_rule: string;
  version: number;
}
// A value copy, ready to persist in an E2 opening. E1 previews are NOT history.
export function policySnapshot(location: LocationPolicy) {
  return Object.freeze({
    schemaVersion: 1,
    locationId: location.id,
    locationVersion: location.version,
    name: location.name,
    latitude: location.latitude,
    longitude: location.longitude,
    radius: location.radius,
    geoRequired: location.geo_required,
    precisionRule: location.precision_rule,
  });
}
