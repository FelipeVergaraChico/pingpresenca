import { useRef, useState } from 'react';
import { api, type Account, type Installation } from './api';
import { displayTime } from './academic/types';
import { useUiStore } from './ui-store';

export function DemoBanner({ installation, onLogout }: {
  installation: Installation; onLogout?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!installation.demo) return null;
  return <aside className="demo-banner" aria-label="Aviso de demonstração pública">
    <div><strong>Demonstração pública · dados compartilhados · sem validade acadêmica</strong>
      <p>Não insira informações reais. Outros visitantes podem alterar estes registros.
        {' '}Ciclo até {displayTime(installation.demo.expiresAt, installation.timeZone)}.
        {' '}Os dados fictícios serão descartados na restauração.</p>
      <p>Se testar GPS, distância e precisão ficarão visíveis aos visitantes. Coordenadas exatas não são armazenadas.</p>
    </div>
    {onLogout && <button className="secondary" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await onLogout(); } catch { setError('Não foi possível trocar o perfil. Tente novamente.'); }
      finally { setBusy(false); }
    }}>Trocar perfil</button>}
    {error && <p role="alert">{error}</p>}
  </aside>;
}

export function DemoLanding({ installation, onEnter, scanning }: {
  installation: Installation; onEnter: (account: Account) => void; scanning: boolean;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const unavailable = installation.demo?.expired || installation.demo?.remainingOperations === 0;
  async function enter(profile: string) {
    setBusy(true); setError('');
    try {
      await api('/demo/login', { profile });
      const account = await api<Account>('/auth/me');
      useUiStore.getState().reset();
      onEnter(account);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível entrar na demonstração.');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { setBusy(false); }
  }
  return <>
    <a className="skip-link" href="#demo-content">Ir para o conteúdo</a>
    <DemoBanner installation={installation} />
    <main id="demo-content" className="demo-landing">
      <header className="demo-intro">
        <a className="brand" href="/">ping presença.</a>
        <p className="eyebrow">EXPERIMENTE · SEM CADASTRO · SOFTWARE LIVRE</p>
        <h1>Uma chamada.<br /><em>Dois pontos de vista.</em></h1>
        <p className="lead">Abra a chamada como professor. Confirme como aluno.
          Veja o registro, a frequência e a história de cada decisão.</p>
        <p>Este é um laboratório compartilhado, não uma instituição real. Os perfis abaixo são fictícios
          e não comprovam a identidade dos visitantes. Não use esta instalação para controlar frequência real.</p>
      </header>
      <section className="demo-access" aria-labelledby="demo-profiles">
        <h2 id="demo-profiles">Escolha seu ponto de vista</h2>
        {scanning && <p className="message">Você abriu uma chamada por link ou QR. Escolha um aluno para continuar.
          Se o código tiver vencido, leia o QR atual novamente.</p>}
        {unavailable && <p role="status" className="message">Este ciclo terminou ou atingiu seu limite.
          A demonstração aguarda restauração pelo responsável.</p>}
        {error && <p className="message error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
        <div className="demo-profile-grid" aria-busy={busy}>
          <article className="demo-profile">
            <span className="eyebrow">01 / QUEM ENSINA</span><h3>Professor</h3>
            <p>Abra uma das aulas preparadas, projete o QR, acompanhe os registros e analise pendências.</p>
            <button className="primary" disabled={busy || unavailable} onClick={() => void enter('professor')}>
              Experimentar como professor <span aria-hidden="true">↗</span>
            </button>
          </article>
          <article className="demo-profile">
            <span className="eyebrow">02 / QUEM APRENDE</span><h3>Aluno</h3>
            <p>Abra em outro navegador ou celular para manter o professor conectado. Todos os visitantes compartilham estes três alunos.</p>
            <div className="demo-students">{[1, 2, 3].map(n => <button className="secondary" key={n}
              disabled={busy || unavailable} onClick={() => void enter(`aluno-${n}`)}>Entrar como aluno {n}</button>)}</div>
          </article>
        </div>
      </section>
      <section className="demo-guide" aria-labelledby="demo-how">
        <h2 id="demo-how">Um roteiro para o primeiro teste</h2>
        <ol>
          <li><strong>Abra a primeira aula.</strong> Como professor, escolha a turma, abra “Sua primeira chamada” e inicie a chamada.</li>
          <li><strong>Use outro dispositivo.</strong> Leia o QR com o celular ou informe o código de seis dígitos como aluno.</li>
          <li><strong>Confirme e acompanhe.</strong> Clique em confirmar presença, volte ao professor e feche a chamada para consultar a frequência.</li>
        </ol>
        <details><summary>Como experimentar a localização e as pendências?</summary>
          <p>A primeira aula não exige GPS. A segunda usa um local fixo de referência no centro de São Paulo,
            com raio de 100 metros. Em outros lugares, rejeição ou pendência é esperada. Negar a permissão após
            confirmar gera pendência para análise do professor. Não simulamos a posição nem garantimos presença física.</p>
        </details>
        <p>Sem cadastro público de instituições, convites, recuperação ou acesso administrativo nesta demonstração.
          QR, prazos e decisões usam as regras reais do sistema. Se outro visitante já confirmou com um aluno,
          escolha outro perfil ou crie outra aula de teste como professor.</p>
      </section>
      <footer className="page-footer">Software livre · AGPL-3.0-only · Demonstração experimental, não MVP completo</footer>
    </main>
  </>;
}
