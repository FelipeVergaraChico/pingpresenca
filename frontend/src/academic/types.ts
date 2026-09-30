export interface ManagedAccount {
  id: string;
  name: string;
  email: string;
  roles: string[];
  active: boolean;
  accepted: boolean;
  institutional_id: string | null;
  email_verified_at: string | null;
  version: number;
}
export interface Discipline {
  id: string;
  name: string;
  description: string;
  version: number;
}
export interface Location {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  geo_required: boolean;
  version: number;
}
export interface Offering {
  id: string;
  discipline_id: string;
  discipline_name: string;
  name: string;
  term: string;
  shift: string;
  active: boolean;
  attendance_mode: string;
  version: number;
  can_manage: boolean;
  can_view_history?: boolean;
}
export interface Lesson {
  attendance_status: string;
  id: string;
  offering_id: string;
  location_id: string;
  location_name: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  attendance_mode: string;
  version: number;
  context_locked_at: string | null;
  cancelled_at?: string | null;
  mode_locked_at: string | null;
}
export interface Enrollment {
  can_end: boolean;
  id: string;
  account_id: string;
  name: string;
  enrolled_at: string;
  ended_at: string | null;
  version: number;
}
export interface Members {
  teachers: { account_id: string; name: string }[];
  enrollments: Enrollment[];
}
export interface Catalog {
  disciplines: Discipline[];
  locations: Location[];
}
export function localInput(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
export function displayTime(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(instant));
}
