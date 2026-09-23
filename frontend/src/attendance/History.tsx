import { displayTime } from '../academic/types';
import { stateName, sourceName } from './types';
import { useLive } from './useLive';
interface HistoryData {
  frequency: {
    mode: string;
    present: number;
    absent: number;
    pending: number;
    provisional: boolean;
    percent: number | null;
  }[];
  lessons: {
    id: string;
    title: string;
    starts_at: string;
    attendance_mode: string;
    status: string | null;
    source: string | null;
    reason: string | null;
    included: boolean;
    cancelled?: boolean;
    reopened?: boolean;
  }[];
}
export function History({ offeringId, timeZone }: { offeringId: string; timeZone: string }) {
  const { data, error } = useLive<HistoryData>(`/attendance/history/${offeringId}`);
  return (
    <section aria-label="Meu histórico de frequência">
      <h3>Minha frequência</h3>
      {error && <p role="alert">{error}</p>}
      {data?.frequency.map((f) => (
        <div className="message" key={f.mode}>
          <strong>
            {f.mode === 'PILOT' ? 'Piloto / teste' : 'Oficial'}:{' '}
            {f.percent === null ? 'Frequência ainda não calculada' : `${f.percent.toFixed(1)}%`}
            {f.provisional ? ' · Provisória' : ''}
          </strong>
          <p>
            {f.present} presença(s), {f.absent} ausência(s), {f.pending} pendência(s).
          </p>
        </div>
      ))}
      <ul>
        {data?.lessons.map((l) => (
          <li key={l.id}>
            <a href={`/#attendance=${l.id}`}>{l.title}</a> · {displayTime(l.starts_at, timeZone)} ·{' '}
            {l.attendance_mode === 'PILOT' ? 'Piloto' : 'Oficial'}
            <p>
              {stateName(l.status)} · {sourceName(l.source)}{' '}
              {l.cancelled ? '· Aula cancelada — fora do cálculo' : l.reopened ? '· Chamada reaberta — frequência provisória' : l.included ? '' : '· Ainda fora do cálculo'}
            </p>
            {l.reason && <p>{l.reason}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
