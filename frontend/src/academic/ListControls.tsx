import { useEffect, useId, useState } from 'react';

export interface PaginationData { page: number; pages: number; pageSize: number; total: number }
export interface ListFilters { from: string; to: string; mode: string; status: string }
export const emptyFilters: ListFilters = { from: '', to: '', mode: '', status: '' };
export function listQuery(page: number, filters: ListFilters, scope = 'all') {
  const q = new URLSearchParams({ page: String(page), pageSize: '10', scope });
  for (const [key, value] of Object.entries(filters)) if (value) q.set(key, value);
  return q.toString();
}
export function ListFiltersForm({ filters, onApply, timeZone, history = false }: {
  filters: ListFilters; onApply: (filters: ListFilters) => void; timeZone: string; history?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(filters);
  useEffect(() => { setDraft(filters); }, [filters]);
  // Keep the draft separate from the applied query, without remounting focused controls.
  return <form className="list-filters" onSubmit={(e) => {
    e.preventDefault();
    onApply({ ...draft });
  }}>
    <label>De<input name="from" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
    <label>Até<input name="to" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
    <label><span id={`${id}-mode`}>Modo</span><select name="mode" aria-labelledby={`${id}-mode`} value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
      <option value="">Todos</option><option value="PILOT">Piloto / teste</option><option value="OFFICIAL">Oficial</option>
    </select></label>
    <label><span id={`${id}-status`}>{history ? 'Meu registro' : 'Situação da chamada'}</span><select name="status" aria-labelledby={`${id}-status`} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
      <option value="">Todas</option>
      {history ? <><option value="PRESENT">Presença</option><option value="ABSENT">Ausência</option><option value="PENDING">Pendente</option><option value="NONE">Sem registro</option></>
        : <><option value="NOT_OPENED">Não aberta</option><option value="OPEN">Aberta</option><option value="CLOSED">Fechada</option><option value="CANCELLED">Aula cancelada</option></>}
    </select></label>
    <div className="actions"><button className="primary" type="submit">Aplicar filtros</button><button type="button" className="secondary" onClick={() => { setDraft({ ...emptyFilters }); onApply({ ...emptyFilters }); }}>Limpar filtros</button></div>
    <p className="muted list-filters-help">Datas do início da aula, inclusive, no fuso {timeZone}.</p>
  </form>;
}
export function Pagination({ data, onPage }: { data: PaginationData; onPage: (page: number) => void }) {
  return <nav className="list-pagination" aria-label="Páginas de aulas">
    <p role="status">{data.total} aula(s) · Página {data.page} de {data.pages}</p>
    <div className="actions"><button className="secondary" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>Anterior</button>
      <button className="secondary" disabled={data.page >= data.pages} onClick={() => onPage(data.page + 1)}>Próxima</button></div>
  </nav>;
}
export function LessonTabs({ value, onChange, tabs, children }: {
  value: string; onChange: (value: string) => void; tabs: { value: string; label: string }[]; children: React.ReactNode;
}) {
  const id = useId();
  return <>
    <div role="tablist" aria-label="Consulta de aulas" className="lesson-tabs">
      {tabs.map((tab, i) => <button key={tab.value} id={`${id}-${tab.value}`} role="tab" aria-selected={value === tab.value}
        aria-controls={`${id}-panel`} tabIndex={value === tab.value ? 0 : -1}
        onClick={() => onChange(tab.value)} onKeyDown={(e) => {
          const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
          if (next === null) return;
          e.preventDefault(); onChange(tabs[next]!.value);
          document.getElementById(`${id}-${tabs[next]!.value}`)?.focus();
        }}>{tab.label}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}`} tabIndex={0}>{children}</div>
  </>;
}
