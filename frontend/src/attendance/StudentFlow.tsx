import { useEffect, useRef, useState } from 'react';
import { api, type Account } from '../api';
import { ActionForm, Field, value } from '../academic/Form';
import { displayTime } from '../academic/types';
import { stateName, type Authorization } from './types';
import { useRemaining } from './useLive';

export type BrowserGeo =
  | {
      status: 'AVAILABLE';
      latitude: number;
      longitude: number;
      accuracy: number;
    }
  | { status: 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' };
export function obtainLocation(): Promise<BrowserGeo> {
  if (!navigator.geolocation) return Promise.resolve({ status: 'UNAVAILABLE' });
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            status: 'AVAILABLE',
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
          }),
        (e) =>
          resolve({
            status: e.code === 1 ? 'DENIED' : e.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE',
          }),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    } catch {
      resolve({ status: 'UNAVAILABLE' });
    }
  });
}
export function StudentFlow({
  lessonId,
  qr,
  account,
  timeZone,
  onResult,
}: {
  lessonId: string;
  qr?: string;
  account: Account;
  timeZone: string;
  onResult: () => Promise<void>;
}) {
  const [auth, setAuth] = useState<Authorization | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [result, setResult] = useState<{
    outcome: string;
    message: string;
  } | null>(null);
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null);
  const active = useRef(true),
    heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (error || result) heading.current?.focus();
  }, [error, result]);
  const remaining = useRemaining(auth?.serverNow, auth?.expiresAt);
  async function submit() {
    if (!auth || busy) return;
    setBusy(true);
    setError('');
    const geo = auth.geoRequired ? await obtainLocation() : { status: 'UNAVAILABLE' as const };
    if (!active.current) return;
    // Coordinates exist only in this closure for the request; no store/localStorage.
    const send = async () => {
      const response = await api<{ outcome: string; message: string }>(
        `/attendance/${lessonId}/confirm`,
        { token: auth.token, geo },
      );
      if (active.current) {
        setResult(response);
        setAuth(null);
        setRetry(null);
        await onResult().catch(() => {});
      }
    };
    try {
      await send();
    } catch (e) {
      if (active.current) {
        setError(e instanceof Error ? e.message : 'Não foi possível confirmar.');
        // Retain only the authorization, NOT geo, when transport outcome is unknown.
        setRetry(() => async () => {
          const response = await api<{
            outcome: string | null;
            message: string;
          }>(`/attendance/${lessonId}/result`, { token: auth.token });
          if (active.current) {
            setResult(
              response.outcome ? { outcome: response.outcome, message: response.message } : null,
            );
            setError(response.outcome ? '' : response.message);
            setAuth(null);
            setRetry(null);
            await onResult().catch(() => {});
          }
        });
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <section className="editor" aria-label="Confirmar presença">
      <h2>Minha presença</h2>
      <p>
        Conta conectada: <strong>{account.name}</strong> · {account.email}
      </p>
      <p>Conta incorreta? Volte ao início, saia e entre com sua conta antes de continuar.</p>
      {!auth && (
        <ActionForm
          key={result?.outcome ?? 'code'}
          submit={qr ? 'Validar QR ou código' : 'Validar código'}
          onSave={async (data) => {
            const code = value(data, 'code');
            const response = await api<Authorization>(
              `/attendance/${lessonId}/authorize`,
              code ? { code } : { qr },
            );
            setAuth(response);
            setResult(null);
            setError('');
            setRetry(null);
          }}
        >
          {qr && <p>QR recebido. Se estiver expirado, informe abaixo o código atual projetado.</p>}
          <Field label="Código da chamada" name="code" required={!qr} maxLength={6} />
          <p>Validar o código não registra presença.</p>
        </ActionForm>
      )}
      {auth && (
        <div className="message">
          <h3>
            {auth.lesson.offering} · {auth.lesson.title}
          </h3>
          <p>
            {displayTime(auth.lesson.startsAt, timeZone)} até{' '}
            {displayTime(auth.lesson.endsAt, timeZone)}
          </p>
          <p>{auth.lesson.mode === 'PILOT' ? 'Piloto / teste — não oficial' : 'Oficial'}</p>
          <p>
            {auth.geoRequired
              ? 'Sua localização será solicitada somente ao confirmar.'
              : 'Localização não obrigatória nesta abertura.'}
          </p>
          <p aria-live="off">Tempo disponível: {remaining}s</p>
          {!remaining && !busy && (
            <p role="status">Autorização expirada. Inicie novamente com o código atual.</p>
          )}
          <button
            className="primary"
            disabled={busy || remaining === 0 || !!retry}
            onClick={() => void submit()}
          >
            {busy ? 'Validando presença…' : 'Confirmar minha presença'}
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setAuth(null);
              setRetry(null);
              setError('');
            }}
          >
            Cancelar e usar código atual
          </button>
        </div>
      )}
      {(error || result) && (
        <div ref={heading} tabIndex={-1} role={error ? 'alert' : 'status'} className="message">
          {error || (
            <>
              <strong>{stateName(result!.outcome)}</strong>
              <p>{result!.message}</p>
            </>
          )}
          {retry && (
            <p>Se houve perda de conexão, consulte o resultado antes de tentar novamente.</p>
          )}
          {retry && (
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await retry();
                } catch {
                  setError('Sem conexão. Tente consultar novamente.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Consultar resultado sem reenviar localização
            </button>
          )}
        </div>
      )}
    </section>
  );
}
