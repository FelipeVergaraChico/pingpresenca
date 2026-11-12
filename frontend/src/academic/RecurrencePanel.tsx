import { useRef, useState } from 'react';
import { api } from '../api';
import { FormLabel, ValidationGroup } from '../FormValidation';
import { ActionForm, Field, ModeField, value } from './Form';
import { displayTime, type Catalog } from './types';

interface Preview {
  timeZone: string; previewHash: string; createCount: number;
  occurrences: { startsAt: string; endsAt: string; action: string }[];
}
export function RecurrencePanel({ offeringId, mode, catalog, refresh }: {
  offeringId: string; mode: string; catalog: Catalog; refresh: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [input, setInput] = useState<Record<string, unknown> | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const revision = useRef(0);
  const pending = useRef(false);
  return <details className="editor recurrence-editor">
    <summary>Programar aulas recorrentes</summary>
    <p>Escolha um período de até 366 dias e os dias da semana. Para horários diferentes, gere outro lote. Cada aula poderá ser editada individualmente; nenhuma chamada será aberta.</p>
    <div onChangeCapture={() => { revision.current++; setPreview(null); setMessage(''); }}>
      <ActionForm submit="Visualizar prévia" success="" onSave={async data => {
        if (pending.current) return;
        setPreview(null);
        const current = revision.current;
        const body = { from: value(data, 'from'), until: value(data, 'until'), weekdays: data.getAll('weekdays').map(Number),
          starts: value(data, 'starts'), ends: value(data, 'ends'), title: value(data, 'title'), description: value(data, 'description'),
          locationId: value(data, 'locationId'), attendanceMode: value(data, 'attendanceMode') };
        const result = await api<Preview>(`/offerings/${offeringId}/recurrence/preview`, body);
        if (current !== revision.current) return;
        setInput(body); setPreview(result); setPage(0); setMessage('');
      }}>
        <fieldset disabled={busy}>
          <Field name="title" label="Título das aulas" maxLength={160} />
          <Field name="description" label="Descrição das aulas" required={false} maxLength={2000} />
          <div className="columns"><Field name="from" label="Primeiro dia do período" type="date" /><Field name="until" label="Último dia do período" type="date" /></div>
          <ValidationGroup name="weekdays" legend="Dias da semana">
            <div className="recurrence-weekdays">{['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((day, i) => <FormLabel key={day} className="checkbox-label"><input type="checkbox" name="weekdays" value={i} />{day}</FormLabel>)}</div>
          </ValidationGroup>
          <div className="columns"><Field name="starts" label="Horário de início" type="time" /><Field name="ends" label="Horário de término" type="time" /></div>
          <p className="muted">Se o término for anterior ao início, a aula termina no dia seguinte. O último dia do período limita o início, não o término.</p>
          <FormLabel>Local das aulas<select name="locationId" required defaultValue=""><option value="">Selecione</option>{catalog.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></FormLabel>
          <ModeField initial={mode} />
        </fieldset>
      </ActionForm>
    </div>
    {preview && <section aria-label="Prévia de aulas recorrentes">
      <h4>{preview.createCount} nova(s) aula(s) · {preview.occurrences.length - preview.createCount} preservada(s)</h4>
      <p>Fuso: {preview.timeZone}. Ocorrências já existentes ou anteriormente geradas não serão substituídas, mesmo se editadas ou canceladas.</p>
      <ol start={page * 10 + 1}>{preview.occurrences.slice(page * 10, page * 10 + 10).map(o => <li key={o.startsAt}>{displayTime(o.startsAt, preview.timeZone)} → {displayTime(o.endsAt, preview.timeZone)} · {o.action === 'CREATE' ? 'Criar' : 'Preservar existente'}</li>)}</ol>
      <nav aria-label="Páginas da prévia"><button type="button" className="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</button> <span>Página {page + 1} de {Math.ceil(preview.occurrences.length / 10)}</span> <button type="button" className="secondary" disabled={(page + 1) * 10 >= preview.occurrences.length} onClick={() => setPage(p => p + 1)}>Próxima</button></nav>
      <button type="button" className="primary" disabled={busy || preview.createCount === 0} onClick={async () => {
        if (pending.current) return;
        pending.current = true; setBusy(true); setMessage('');
        try {
          const result = await api<{ created: number; kept: number }>(`/offerings/${offeringId}/recurrence/generate`, { ...input, previewHash: preview.previewHash });
          setPreview(null); setMessage(`Lote concluído: ${result.created} aula(s) criada(s), ${result.kept} preservada(s).`);
          try { await refresh(); } catch { setMessage('Lote salvo. Não foi possível atualizar a lista; atualize a página.'); }
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível gerar.'); }
        finally { pending.current = false; setBusy(false); }
      }}>{busy ? 'Gerando…' : 'Confirmar geração das aulas'}</button>
    </section>}
    {message && <p role="status" className="message">{message}</p>}
  </details>;
}
