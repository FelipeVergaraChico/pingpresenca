import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { ActionForm, Field } from './academic/Form';

export function Invitation({ token }: { token: string }) {
  return <InvitationForToken key={token} token={token} />;
}

function InvitationForToken({ token }: { token: string }) {
  const active = useRef(true);
  const [info, setInfo] = useState<{ name: string; email: string; channel: string } | null>(null),
    [error, setError] = useState(''),
    [done, setDone] = useState(false);
  useEffect(() => {
    active.current = true;
    let alive = true;
    api<{ name: string; email: string; channel: string }>('/invitations/inspect', { token })
      .then((r) => {
        if (alive) setInfo(r);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      active.current = false;
    };
  }, [token]);
  return (
    <main className="invitation-page">
      <a href="/" className="brand">
        ping presença.
      </a>
      <p className="eyebrow">CONVITE INDIVIDUAL</p>
      <h1>{done ? 'Cadastro concluído.' : 'Seu lugar na comunidade.'}</h1>
      {error ? (
        <p role="alert" className="message error">
          {error}
        </p>
      ) : done ? (
        <>
          <p role="status">
            Sua senha foi definida. Seus papéis e vínculos foram preservados; seu e-mail continua
            não verificado.
          </p>
          <a href="/">Voltar ao acesso da instalação</a>
        </>
      ) : !info ? (
        <p role="status">Verificando convite…</p>
      ) : (
        <>
          <h2>{info.name}</h2>
          <p>{info.email}</p>
          <p>
            Convite entregue manualmente. Aceitar não comprova posse deste e-mail. Se esta não for
            sua conta, não prossiga.
          </p>
          <ActionForm
            submit="Aceitar convite e definir senha"
            onSave={async (data) => {
              if (String(data.get('password')) !== String(data.get('confirmation')))
                throw new ApiError(400, 'As senhas não coincidem.', [
                  {
                    field: 'confirmation',
                    message: 'Confirmação da senha: repita exatamente a senha informada.',
                  },
                ]);
              await api('/invitations/accept', { token, password: String(data.get('password')) });
              if (!active.current) return;
              history.replaceState(null, '', '/');
              setDone(true);
            }}
          >
            <Field label="Nova senha" name="password" type="password" />
            <Field label="Confirmar nova senha" name="confirmation" type="password" />
            <p className="muted">
              Use entre 12 e 128 caracteres. Papéis e turmas são definidos somente pela
              administração.
            </p>
          </ActionForm>
        </>
      )}
    </main>
  );
}
