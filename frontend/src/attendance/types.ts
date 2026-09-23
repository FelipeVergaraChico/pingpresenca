export interface AttendanceLesson {
  id: string;
  title: string;
  offeringId: string;
  offering: string;
  discipline: string;
  startsAt: string;
  endsAt: string;
  mode: string;
}
export interface AttendanceRecord {
  account_id: string;
  name: string;
  status: string | null;
  source: string | null;
  reason: string | null;
  version: number;
  manual: boolean | null;
}
export interface Attempt {
  id: string;
  account_id: string;
  outcome: string;
  reason: string;
  message: string;
  recorded_at: string;
  distance: number | null;
  accuracy: number | null;
  resolution: string | null;
}
export interface View {
  lesson: AttendanceLesson;
  manages: boolean;
  administrative: boolean;
  serverNow: string;
  state: 'NOT_OPENED' | 'OPEN' | 'CLOSED' | 'CANCELLED';
  lessonVersion?: number;
  openingId?: string | null;
  expiresAt: string | null;
  defaultMinutes: number;
  records: AttendanceRecord[];
  attempts: Attempt[];
  audit: {
    id: string;
    actor_id: string | null;
    actor_kind: string;
    actor_role: string | null;
    action: string;
    occurred_at: string;
    details: Record<string, unknown>;
  }[];
}
export interface Authorization {
  token: string;
  expiresAt: string;
  serverNow: string;
  lesson: AttendanceLesson;
  geoRequired: boolean;
}
export interface ProjectionData {
  lesson: AttendanceLesson;
  serverNow: string;
  open: boolean;
  code?: string;
  qrUrl?: string;
  rotatesAt?: string;
  expiresAt?: string;
}
export const stateName = (s: string | null) =>
  ({
    PRESENT: 'Presença confirmada',
    ABSENT: 'Ausente',
    PENDING: 'Pendente',
    ACCEPTED: 'Presença confirmada',
    REJECTED: 'Tentativa rejeitada',
    OPEN: 'Chamada aberta',
    CLOSED: 'Chamada encerrada',
    CANCELLED: 'Aula cancelada — fora da frequência',
    NOT_OPENED: 'Chamada não iniciada',
  })[s ?? ''] ?? 'Sem registro';
export const sourceName = (s: string | null) =>
  ({
    AUTOMATIC: 'Validação automática',
    AUTO_CLOSE: 'Ausência automática',
    MANUAL: 'Presença manual',
    PENDING_DECISION: 'Decisão de pendência',
    CORRECTION: 'Correção manual',
  })[s ?? ''] ?? '';
