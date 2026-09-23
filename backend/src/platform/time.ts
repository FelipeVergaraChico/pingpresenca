import { Temporal } from '@js-temporal/polyfill';

export function isTimeZone(value: string): boolean {
  if (value !== 'UTC' && !value.includes('/')) return false;
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: value }); return true; }
  catch { return false; }
}

// Explicit zone and rejection of ambiguous/nonexistent local times. No browser TZ.
export function localToInstant(local: string, timeZone: string): string {
  if (!isTimeZone(timeZone)) throw new Error('Fuso inválido');
  return Temporal.PlainDateTime.from(local)
    .toZonedDateTime(timeZone, { disambiguation: 'reject' }).toInstant().toString();
}

export function formatInstant(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone, dateStyle: 'short', timeStyle: 'medium',
  }).format(new Date(instant));
}

export function isWithinInterval(instant: string, start: string, end: string): boolean {
  const time = Temporal.Instant.from(instant);
  return Temporal.Instant.compare(time, Temporal.Instant.from(start)) >= 0 &&
    Temporal.Instant.compare(time, Temporal.Instant.from(end)) < 0;
}
