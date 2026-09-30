import { displayTime } from '../academic/types';
import { stateName, sourceName } from './types';
import { useLive } from './useLive';
import { useRef, useState } from 'react';
import { emptyFilters, listQuery, ListFiltersForm, Pagination, type PaginationData } from '../academic/ListControls';
interface HistoryData {
  pagination: PaginationData;
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
  const [filters, setFilters] = useState({ ...emptyFilters }), [page, setPage] = useState(1);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const { data, error } = useLive<HistoryData>(`/attendance/history/${offeringId}?${listQuery(page, filters, 'past')}`);
  return (
    <section className="frequency-history" aria-label="Meu histórico de frequência">
      <h3>Minha frequência</h3>
      <p className="muted">Resumo da turma inteira, independente dos filtros e da página. Aulas de piloto e oficiais têm cálculos separados.</p>
      {error && <p role="alert" className="message error">{error}</p>}
      {!data && !error && <p role="status">Carregando sua frequência…</p>}
      <div className="frequency-summary">
      {data?.frequency.map((f) => (
        <div className="frequency-summary-card" key={f.mode}>
          <h4>{f.mode === 'PILOT' ? 'Piloto / teste' : 'Oficial'}</h4>
          <p className={`frequency-value${f.percent === null ? ' frequency-value--empty' : ''}`}>
            {f.percent === null ? 'Frequência ainda não calculada' : `${f.percent.toFixed(1)}%`}
          </p>
          {f.provisional && <span className="frequency-status" data-status="PENDING">Provisória</span>}
          <p className="frequency-counts">
            {f.present} presença(s), {f.absent} ausência(s), {f.pending} pendência(s).
          </p>
        </div>
      ))}
      </div>
      <h4 className="frequency-list-heading">Histórico de aulas</h4>
      <p className="muted">Aulas cujo horário planejado já terminou. Para uma aula em andamento, consulte Próximas aulas.</p>
      <ListFiltersForm history filters={filters} timeZone={timeZone} onApply={(value) => { setFilters(value); setPage(1); }} />
      <h4 ref={resultsHeading} tabIndex={-1}>Registros encontrados</h4>
      {data?.lessons.length === 0 && <p className="frequency-empty">Nenhuma aula disponível no seu histórico desta turma.</p>}
      <ul className="frequency-lessons">
        {data?.lessons.map((l) => (
          <li className="frequency-lesson" key={l.id}>
            <div className="frequency-lesson-heading">
              <div>
                <a className="frequency-lesson-link" href={`/#attendance=${l.id}`}>
                  <span>{l.title}</span><span aria-hidden="true">↗</span>
                </a>
                <p className="frequency-date"><time dateTime={l.starts_at}>{displayTime(l.starts_at, timeZone)}</time> · {l.attendance_mode === 'PILOT' ? 'Piloto / teste — não oficial' : 'Oficial'}</p>
              </div>
              <span className="frequency-status" data-status={l.status ?? 'NONE'}>{stateName(l.status)}</span>
            </div>
            {l.source && <p className="frequency-source">{sourceName(l.source)}</p>}
            {(l.cancelled || l.reopened || !l.included) && <p className="frequency-notice">{l.cancelled ? 'Aula cancelada — fora do cálculo' : l.reopened ? 'Chamada reaberta — frequência provisória' : 'Ainda fora do cálculo'}</p>}
            {l.reason && <p className="frequency-reason">{l.reason}</p>}
          </li>
        ))}
      </ul>
      {data && <Pagination data={data.pagination} onPage={(next) => { resultsHeading.current?.focus(); setPage(next); }} />}
    </section>
  );
}
