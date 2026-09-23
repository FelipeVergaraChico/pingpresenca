import { useState } from 'react';
import { api } from '../api';
import { ActionForm } from '../academic/Form';
import { FormLabel } from '../FormValidation';
import { useLive } from './useLive';
type Policy = { minutes: number; version: number };

function PolicyEditor({ current, reload }: { current: Policy; reload: () => Promise<void> }) {
  const [baseVersion, setBaseVersion] = useState(current.version);
  const [minutes, setMinutes] = useState(String(current.minutes));
  const [reason, setReason] = useState('');
  const changed = current.version > baseVersion;
  return (
    <ActionForm
      onConflict={() => { void reload().catch(() => {}); }}
      onSave={async () => {
        if (changed) throw new Error('A política foi alterada. Revise a versão atual antes de salvar; seu rascunho foi preservado.');
        await api('/attendance/settings', { minutes: Number(minutes), reason: reason.trim(), version: baseVersion });
        setBaseVersion(baseVersion + 1);
        return reload;
      }}
    >
      {changed && (
        <div className="message" role="status">
          <p>A política foi alterada por outra operação: duração atual de {current.minutes} minutos,
            versão {current.version}. Seu rascunho foi preservado. Confira os valores antes de salvar.</p>
          <button type="button" className="secondary" onClick={() => setBaseVersion(current.version)}>
            Revisei a versão atual; manter meu rascunho
          </button>
        </div>
      )}
      <FormLabel>
        Duração padrão da chamada (minutos)
        <input name="minutes" type="number" min={1} max={1440} required value={minutes}
          onChange={(event) => setMinutes(event.target.value)} />
      </FormLabel>
      <FormLabel>
        Justificativa da política de chamada
        <input name="reason" required value={reason} onChange={(event) => setReason(event.target.value)} />
      </FormLabel>
      <p>Aplica-se a novas aberturas; não altera prazos já fixados.</p>
    </ActionForm>
  );
}
export function AttendanceSettings() {
  const { data, error, reload } = useLive<{ minutes: number; version: number }>(
    '/attendance/settings',
  );
  return (
    <section>
      <h2>Política de chamada</h2>
      {error && <p role="alert">{error}</p>}
      {data && <PolicyEditor current={data} reload={reload} />}
    </section>
  );
}
