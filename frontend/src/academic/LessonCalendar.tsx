import { useEffect, useRef, useState } from 'react';
import { useLive } from '../attendance/useLive';
import { listQuery, Pagination, type ListFilters, type PaginationData } from './ListControls';
import { LessonRows, type LessonActions } from './LessonRows';
import type { Lesson } from './types';

// Civil dates for drawing only. No device clock or device timezone decides the month or eligibility.
export function monthDays(month: string) {
  const start = new Date(`${month}-01T12:00:00Z`);
  const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
  return { offset: start.getUTCDay(), days: end.getUTCDate(),
    label: new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start) };
}
export function adjacentMonth(month: string, delta: number) {
  const date = new Date(`${month}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}
type CalendarData = { month: string; days: { date: string; total: number }[] };
export function LessonCalendar({ offeringId, scope, filters, revision, ...actions }: LessonActions & {
  offeringId: string; scope: string; filters: ListFilters; revision: number;
}) {
  const [month, setMonth] = useState(() => {
    const candidate = filters.from.slice(0, 7) || filters.to.slice(0, 7);
    return /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(candidate) ? candidate : '';
  }),
    [selected, setSelected] = useState('');
  const query = new URLSearchParams(listQuery(1, filters, scope));
  query.set('view', 'calendar'); if (month) query.set('month', month);
  const { data, error, reload } = useLive<CalendarData>(`/offerings/${offeringId}/lessons?${query}`, 30000);
  useEffect(() => { if (revision) void reload().catch(() => {}); }, [revision, reload]);
  const activeMonth = data?.month ?? month;
  const grid = activeMonth ? monthDays(activeMonth) : null;
  function changeMonth(value: string) { setMonth(value); setSelected(''); }
  return <section className="lesson-calendar" aria-label="Calendário de aulas">
    <div className="calendar-toolbar">
      <h4 aria-live="polite">{grid?.label ?? 'Calendário mensal'}</h4>
      <div className="actions">
        <button className="secondary" disabled={!activeMonth || activeMonth === '0001-01'} onClick={() => changeMonth(adjacentMonth(activeMonth, -1))} aria-label="Mês anterior">←</button>
        <label>Mês<input type="month" min="0001-01" max="9999-12" value={activeMonth} onChange={(e) => {
          if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) changeMonth(e.target.value);
        }} /></label>
        <button className="secondary" disabled={!activeMonth || activeMonth === '9999-12'} onClick={() => changeMonth(adjacentMonth(activeMonth, 1))} aria-label="Próximo mês">→</button>
        <button className="secondary" onClick={() => changeMonth('')}>Mês atual</button>
      </div>
    </div>
    <p className="muted">Selecione um dia para consultar as aulas. Os filtros acima continuam valendo. Cada aula aparece no seu dia de início, em {actions.timeZone}.</p>
    {error && <p role="alert" className="message error">{error}</p>}
    {!data && !error && <p role="status">Carregando calendário…</p>}
    {data && grid && <>
      {data.days.length === 0 && <p role="status">Nenhuma aula neste mês com os filtros atuais.</p>}
      <div className="calendar-grid">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => <span className="calendar-weekday" key={day} aria-hidden="true">{day}</span>)}
        {Array.from({ length: grid.offset }, (_, i) => <span key={`blank-${i}`} aria-hidden="true" />)}
        {Array.from({ length: grid.days }, (_, i) => {
          const date = `${data.month}-${String(i + 1).padStart(2, '0')}`;
          const count = data.days.find((d) => d.date === date)?.total ?? 0;
          const label = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
          return <button key={date} className="calendar-day" aria-pressed={selected === date} disabled={!count}
            aria-label={`${label}: ${count} aula(s)`} onClick={() => setSelected(date)}>
            <span>{i + 1}</span><small>{count ? `${count} aula(s)` : '—'}</small>
          </button>;
        })}
      </div>
    </>}
    {selected && data && <DayLessons key={selected} date={selected} offeringId={offeringId} scope={scope} filters={filters} revision={revision} {...actions} />}
  </section>;
}
function DayLessons({ date, offeringId, scope, filters, revision, ...actions }: LessonActions & {
  date: string; offeringId: string; scope: string; filters: ListFilters; revision: number;
}) {
  const [page, setPage] = useState(1);
  const heading = useRef<HTMLHeadingElement>(null);
  const { data, error, reload } = useLive<{ items: Lesson[]; pagination: PaginationData }>(
    `/offerings/${offeringId}/lessons?${listQuery(page, { ...filters, from: date, to: date }, scope)}`, 30000);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (revision) void reload().catch(() => {}); }, [revision, reload]);
  return <section className="calendar-details" aria-label="Aulas do dia selecionado">
    <h4 ref={heading} tabIndex={-1}>Aulas de {date.split('-').reverse().join('/')}</h4>
    {error && <p role="alert" className="message error">{error}</p>}
    {!data && !error && <p role="status">Carregando aulas do dia…</p>}
    {data?.items.length === 0 && <p>Nenhuma aula disponível neste dia com os filtros atuais.</p>}
    <LessonRows lessons={data?.items ?? []} {...actions} />
    {data && <Pagination data={data.pagination} onPage={(next) => { heading.current?.focus(); setPage(next); }} />}
  </section>;
}
