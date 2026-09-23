import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { ActionForm, Field, value } from './academic/Form';
import { FormLabel } from './FormValidation';

export function Recovery({ token }: { token: string }) {
  const active = useRef(true);
  const [info, setInfo] = useState<{ name: string; email: string } | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    active.current = true;
    let alive = true;
    api<{ name: string; email: string }>('/recovery/inspect', { token }).then(r => { if (alive) setInfo(r); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; active.current = false; };
  }, [token]);
  return <main className="invitation-page"><a className="brand" href="/">ping presença.</a><h1>Recuperar acesso</h1>
    {error ? <p role="alert">{error}</p> : done ? <><p role="status">Senha redefinida. Todas as sessões anteriores foram encerradas. Seus dados e vínculos foram preservados; seu e-mail não foi verificado por esta operação.</p><a className="action-link" href="/">Entrar com a nova senha</a></> : !info ? <p role="status">Verificando autorização…</p> : <>
      <h2>{info.name}</h2><p>{info.email}</p><p>Se esta não for sua conta, não prossiga.</p>
      <ActionForm submit="Definir nova senha" onSave={async form => {
        const password = String(form.get('password') ?? '');
        if (password !== String(form.get('confirmation') ?? '')) throw new ApiError(400, 'As senhas não coincidem.', [{ field: 'confirmation', message: 'Repita exatamente a nova senha.' }]);
        await api('/recovery/complete', { token, password });
        if (!active.current) return;
        history.replaceState(null, '', '/'); setDone(true);
      }}><Field label="Nova senha" name="password" type="password" /><Field label="Confirmar nova senha" name="confirmation" type="password" /><p>Use entre 12 e 128 caracteres. Link de uso único.</p></ActionForm>
    </>}
  </main>;
}

export function RecoveryIssuer({ accountId }: { accountId: string }) {
  const [link, setLink] = useState('');
  return <section aria-label="Recuperação assistida"><h3>Recuperar acesso</h3><p>Confira a identidade da pessoa antes de gerar o link. Entregue-o somente por um canal confiável. A administração não define nem conhece a nova senha.</p>
    <ActionForm submit="Gerar link de recuperação" success="Link gerado. Entregue à pessoa identificada acima." onSave={async form => {
      setLink('');
      const result = await api<{ url: string }>(`/admin/accounts/${accountId}/recovery`, { reason: value(form, 'reason') });
      setLink(result.url);
    }}><Field label="Justificativa da recuperação" name="reason" maxLength={1000} /><p>Expira em 15 minutos e substitui links anteriores. As sessões serão revogadas quando a senha for redefinida.</p></ActionForm>
    {link && <FormLabel>Link privado de recuperação<input readOnly value={link} onFocus={e => e.target.select()} /></FormLabel>}
  </section>;
}
