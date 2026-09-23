import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useLive, useRemaining } from './useLive';
import type { ProjectionData } from './types';

export function Projection({ lessonId }: { lessonId: string }) {
  const { data, error } = useLive<ProjectionData>(`/attendance/${lessonId}/projection`, 1000);
  const [qr, setQr] = useState<{ url: string; image: string } | null>(null),
    [fullscreenError, setFullscreenError] = useState('');
  const root = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const rotation = useRemaining(data?.serverNow, data?.rotatesAt),
    deadline = useRemaining(data?.serverNow, data?.expiresAt);
  const fresh = useRemaining(
    data?.serverNow,
    data ? new Date(Date.parse(data.serverNow) + 3500).toISOString() : undefined,
  );
  useEffect(() => {
    let active = true;
    setQr(null);
    if (data?.qrUrl)
      void QRCode.toDataURL(data.qrUrl, {
        width: 480,
        margin: 4,
        errorCorrectionLevel: 'M',
      })
        .then((image) => {
          if (active) setQr({ url: data.qrUrl!, image });
        })
        .catch(() => {
          if (active) setQr(null);
        });
    return () => {
      active = false;
    };
  }, [data?.qrUrl]);
  const valid = !!data?.open && !error && fresh > 0 && rotation > 0 && deadline > 0;
  return (
    <main className="projection" ref={root}>
      <header className="projection-heading">
        <p className="eyebrow">PING PRESENÇA · PROJEÇÃO</p>
        <h1>{data?.lesson.offering ?? 'Chamada'}</h1>
        {data && (
          <>
            <h2>{data.lesson.title}</h2>
            <p>
              {data.lesson.discipline} ·{' '}
              {data.lesson.mode === 'PILOT' ? 'Piloto / teste — não oficial' : 'Oficial'}
            </p>
          </>
        )}
        <p role="status">
          {error || (data?.open && !valid)
            ? 'Projeção sem sincronização válida. Códigos suspensos.'
            : valid
              ? 'Chamada aberta'
              : data
                ? 'Chamada encerrada ou não iniciada'
                : 'Conectando…'}
        </p>
      </header>
      {valid && (
        <div className="projection-content">
          {qr && qr.url === data?.qrUrl && (
            <img
              src={qr.image}
              width="480"
              height="480"
              alt="QR code para acessar esta chamada. O código digitável nesta tela é uma alternativa."
            />
          )}
          <div className="projection-instructions">
            <p>Código para digitar na chamada</p>
            <p className="attendance-code" aria-label={`Código: ${data?.code?.split('').join(' ')}`}>
              {data?.code}
            </p>
            <p aria-live="off">
              Troca em {rotation}s · Chamada termina em {deadline}s
            </p>
          </div>
        </div>
      )}
      <button
        className="secondary"
        onClick={async () => {
          try {
            setFullscreenError('');
            if (document.fullscreenElement === root.current) {
              await document.exitFullscreen();
              return;
            }
            if (!root.current?.requestFullscreen) throw new Error('Unsupported');
            await root.current.requestFullscreen();
          } catch {
            setFullscreenError('Use a opção de tela cheia do navegador.');
          }
        }}
      >
        {fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
      </button>
      {fullscreenError && <p role="alert">{fullscreenError}</p>}
      {error && (
        <p>Entre na aplicação em outra aba com uma conta autorizada e mantenha a conexão ativa.</p>
      )}
    </main>
  );
}
