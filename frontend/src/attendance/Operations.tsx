import { useState } from 'react';
import { api } from '../api';
import { ActionForm, Field, value } from '../academic/Form';
import { FormLabel } from '../FormValidation';
import { useLive } from './useLive';
import type { View } from './types';

export function Operations({ view, reload }: { view: View; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState<{ action: string; version: number | undefined; openingId: string | null | undefined } | null>(null);
  const { data } = useLive<{ locations: { id: string; name: string }[] }>('/catalog');
  if (view.state === 'CANCELLED') return <p>O histórico foi preservado. Esta aula não aceita novas confirmações.</p>;
  const choose = (action: string) => setEditing({ action, version: view.lessonVersion, openingId: view.openingId });
  return <section aria-label="Operações da aula">
    <h2>Operações da aula</h2>
    {!editing ? <div className="actions">
      {view.state === 'CLOSED' && <button className="secondary" onClick={() => choose('reopen')}>Reabrir chamada</button>}
      {view.state !== 'OPEN' && <button className="secondary" onClick={() => choose('location')}>Alterar local com justificativa</button>}
      <button className="secondary" onClick={() => choose('cancel')}>Cancelar aula</button>
    </div> : <>
      <ActionForm submit={editing.action === 'reopen' ? 'Confirmar reabertura' : editing.action === 'cancel' ? 'Confirmar cancelamento da aula' : 'Salvar novo local'}
        onConflict={() => { setEditing(null); void reload(); }}
        onSave={async form => {
          await api(`/attendance/${view.lesson.id}/${editing.action}`, {
            reason: value(form, 'reason'),
            ...(editing.action === 'reopen' ? { openingId: editing.openingId, minutes: Number(value(form, 'minutes')) }
              : { version: editing.version, ...(editing.action === 'location' ? { locationId: value(form, 'locationId') } : {}) }),
          });
          return async () => { await reload(); setEditing(null); };
        }}>
        {editing.action === 'reopen' && <><Field label="Nova duração (minutos)" name="minutes" type="number" min={1} max={1440} initial={view.defaultMinutes} /><p>Somente durante o horário da aula. Códigos antigos serão invalidados; decisões manuais serão preservadas.</p></>}
        {editing.action === 'cancel' && <p>O cancelamento encerra a chamada, preserva os registros e retira esta aula da frequência. Não pode ser desfeito.</p>}
        {editing.action === 'location' && <FormLabel>Novo local autorizado<select name="locationId" required defaultValue=""><option value="" disabled>Selecione um local</option>{data?.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></FormLabel>}
        <Field label="Justificativa da operação" name="reason" maxLength={1000} />
      </ActionForm>
      <button className="secondary" onClick={() => setEditing(null)}>Voltar sem alterar</button>
    </>}
  </section>;
}
