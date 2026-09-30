import { useEffect, useRef, useState } from 'react';
import { useLive } from '../attendance/useLive';
import type { Lesson } from './types';
import { emptyFilters, listQuery, ListFiltersForm, Pagination, type ListFilters, type PaginationData } from './ListControls';
import { LessonRows, type LessonActions } from './LessonRows';
import { LessonCalendar } from './LessonCalendar';

type Props = LessonActions & { offeringId: string; scope: string; revision: number };
export function LessonList(props: Props) {
  const [filters, setFilters] = useState({ ...emptyFilters }), [view, setView] = useState('list');
  const [filterVersion, setFilterVersion] = useState(0);
  return <section aria-label={props.scope === 'past' ? 'Histórico de aulas' : 'Próximas aulas'}>
    <p className="muted">{props.scope === 'past' ? 'Aulas cujo horário planejado já terminou, com ou sem chamada.' : 'Aulas em andamento e futuras, na ordem do planejamento.'}</p>
    <div className="actions lesson-view-switch" role="group" aria-label="Visualização das aulas">
      <button className="secondary" aria-pressed={view === 'list'} onClick={() => setView('list')}>Lista</button>
      <button className="secondary" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>Calendário</button>
    </div>
    <ListFiltersForm filters={filters} timeZone={props.timeZone} onApply={(value) => { setFilters(value); setFilterVersion((v) => v + 1); }} />
    {view === 'calendar'
      ? <LessonCalendar key={filterVersion} filters={filters} {...props} />
      : <PagedLessons key={filterVersion} filters={filters} {...props} />}
  </section>;
}
function PagedLessons({ offeringId, scope, revision, filters, ...actions }: Props & { filters: ListFilters }) {
  const [page, setPage] = useState(1);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const { data, error, reload } = useLive<{ items: Lesson[]; pagination: PaginationData }>(`/offerings/${offeringId}/lessons?${listQuery(page, filters, scope)}`, 30000);
  useEffect(() => { if (revision) void reload().catch(() => {}); }, [revision, reload]);
  return <>
    <h4 ref={resultsHeading} tabIndex={-1}>Aulas encontradas</h4>
    {error && <p role="alert" className="message error">{error}</p>}
    {!data && !error && <p role="status">Carregando aulas…</p>}
    {data?.items.length === 0 && <p className="empty-state">Nenhuma aula encontrada neste período com estes filtros.</p>}
    <LessonRows lessons={data?.items ?? []} {...actions} />
    {data && <Pagination data={data.pagination} onPage={(next) => { resultsHeading.current?.focus(); setPage(next); }} />}
  </>;
}
