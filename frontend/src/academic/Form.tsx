import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, type FieldError } from '../api';
import { FormValidation, FormLabel, ErrorLinks } from '../FormValidation';

export const value = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
export function Field({
  label,
  name,
  type = 'text',
  initial = '',
  required = true,
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  initial?: string | number;
  required?: boolean;
  min?: string | number;
  max?: string | number;
  step?: string;
  maxLength?: number;
}) {
  return (
    <FormLabel>
      {label}
      <input name={name} type={type} defaultValue={initial} required={required} {...rest} />
    </FormLabel>
  );
}
export function ActionForm({
  children,
  onSave,
  submit = 'Salvar',
  success = 'Alteração salva.',
  onConflict,
}: {
  children: ReactNode;
  // Return the read-only refresh separately: a failed read must not repeat a saved write.
  onSave: (data: FormData) => Promise<void | (() => Promise<void>)>;
  submit?: string;
  success?: string;
  onConflict?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [conflict, setConflict] = useState(false);
  const [pendingRefresh, setPendingRefresh] = useState<(() => Promise<void>) | null>(null);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error && !busy) ref.current?.focus();
  }, [error, busy]);
  async function refreshSaved(refresh: () => Promise<void>) {
    setPendingRefresh(() => refresh);
    try {
      await refresh();
      setPendingRefresh(null);
      setError('');
    } catch {
      setError('Alteração salva, mas não foi possível atualizar os dados da tela. Atualize a lista sem reenviar o cadastro.');
    }
  }
  return (
    <FormValidation.Provider value={fieldErrors}>
      <form
        ref={form}
        onChange={() => { if (!pendingRefresh) { setSaved(false); setNotice(''); } }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current || pendingRefresh || saved) return;
          submitting.current = true;
          const data = new FormData(e.currentTarget);
          setBusy(true);
          setError('');
          setFieldErrors([]);
          setConflict(false);
          setNotice('');
          try {
            const refresh = await onSave(data);
            setSaved(Boolean(refresh));
            setNotice(success);
            if (refresh) await refreshSaved(refresh);
          } catch (err) {
            setFieldErrors(err instanceof ApiError ? err.fieldErrors : []);
            setConflict(err instanceof ApiError && err.code === 'VERSION_CONFLICT');
            setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
        aria-busy={busy}
      >
        <fieldset disabled={busy || !!pendingRefresh}>{children}</fieldset>
        {error && (
          <div ref={ref} tabIndex={-1} role="alert" className="message error">
            {error}
            <ErrorLinks errors={fieldErrors} form={form.current} />
            {pendingRefresh && (
              <button type="button" className="secondary" disabled={busy} onClick={async () => {
                setBusy(true);
                try { await refreshSaved(pendingRefresh); } finally { setBusy(false); }
              }}>
                Atualizar lista
              </button>
            )}
            {onConflict && conflict && (
              <button type="button" className="secondary" onClick={onConflict}>
                Atualizar dados para revisão
              </button>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="message">
            {notice}
          </p>
        )}
        <button className="primary" disabled={busy || !!pendingRefresh || saved}>
          {busy ? 'Salvando…' : submit}
        </button>
      </form>
    </FormValidation.Provider>
  );
}
export function ModeField({ initial = 'PILOT' }: { initial?: string }) {
  // Follow a changed default only until the user explicitly chooses a mode.
  const [choice, setChoice] = useState<string | null>(null);
  return (
    <FormLabel>
      Modo de presença
      <select name="attendanceMode" value={choice ?? initial} onChange={(e) => setChoice(e.target.value)}>
        <option value="PILOT">Piloto / teste — não oficial</option>
        <option value="OFFICIAL">Oficial</option>
      </select>
    </FormLabel>
  );
}
