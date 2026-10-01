import { FormLabel } from './FormValidation';
import { FormValidation, ErrorLinks } from './FormValidation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type Account, type Installation, type FieldError } from './api';
import { useUiStore } from './ui-store';
import { AcademicWorkspace } from './academic/Workspace';
import { Invitation } from './Invitation';
import { Recovery } from './Recovery';
import { AttendancePage } from './attendance/AttendancePage';
import { Projection } from './attendance/Projection';
import { DemoBanner, DemoLanding } from './Demo';

export function App() {
  const [route, setRoute] = useState(() => new URLSearchParams(location.hash.slice(1)));
  const [invite, setInvite] = useState(() =>
    new URLSearchParams(location.hash.slice(1)).get('invite'),
  );
  useEffect(() => {
    const update = () => {
      const next = new URLSearchParams(location.hash.slice(1));
      setInvite(next.get('invite'));
      setRoute(next);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route.get('recovery') ? <Recovery key={route.get('recovery')} token={route.get('recovery')!} /> : invite ? (
    <Invitation token={invite} />
  ) : route.get('project') ? (
    <Projection key={route.get('project')} lessonId={route.get('project')!} />
  ) : (
    <AccessApp
      lessonId={route.get('attendance') ?? undefined}
      qr={route.get('challenge') ?? undefined}
    />
  );
}
function AccessApp({ lessonId, qr }: { lessonId?: string; qr?: string }) {
  const [installation, setInstallation] = useState<Installation | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const showPassword = useUiStore((s) => s.showPassword);
  const togglePassword = useUiStore((s) => s.togglePassword);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api<Installation>('/installation'),
      api<Account>('/auth/me').catch((err) => {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }),
    ])
      .then(([state, user]) => {
        if (alive) {
          setInstallation(state);
          setAccount(user);
          setError('');
        }
      })
      .catch(() => {
        if (alive)
          setError(
            'Não foi possível acessar a instalação. Confira se o serviço está disponível e tente novamente.',
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reload]);

  useEffect(() => {
    if (error && !busy) errorRef.current?.focus();
  }, [error, busy]);

  const setup = installation && !installation.initialized;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError('');
    setFieldErrors([]);
    setNotice('');
    setBusy(true);
    try {
      if (setup) {
        if (data.get('password') !== data.get('confirmation')) {
          throw new ApiError(400, 'As senhas não coincidem. Confira a confirmação.', [
            {
              field: 'confirmation',
              message: 'Confirmação da senha: repita exatamente a senha informada.',
            },
          ]);
        }
        await api('/bootstrap', {
          name: data.get('name'),
          email: data.get('email'),
          password: data.get('password'),
          secret: data.get('secret'),
        });
        form.reset();
        setInstallation(await api<Installation>('/installation'));
        setNotice(
          'Conta responsável criada. Entre com seu e-mail e senha. O segredo inicial já não permite criar outra conta.',
        );
      } else {
        await api('/auth/login', { email: data.get('email'), password: data.get('password') });
        form.reset();
        setAccount(await api<Account>('/auth/me'));
      }
      headingRef.current?.focus();
    } catch (err) {
      setFieldErrors(err instanceof ApiError ? err.fieldErrors : []);
      if (err instanceof ApiError && err.status === 409) {
        setInstallation(await api<Installation>('/installation').catch(() => installation));
      }
      setError(err instanceof Error ? err.message : 'Não foi possível concluir. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await api('/auth/logout', {});
      setAccount(null);
      useUiStore.getState().reset();
      setNotice('Você saiu da sua conta.');
    } catch {
      setError('Não foi possível encerrar a sessão. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  if (account && installation && lessonId)
    return (
      <><DemoBanner installation={installation} onLogout={signOut} />
      <AttendancePage
        key={`${account.id}-${lessonId}`}
        lessonId={lessonId}
        qr={qr}
        account={account}
        timeZone={installation.timeZone}
      />
      </>
    );
  if (account && installation)
    return (
      <><DemoBanner installation={installation} onLogout={signOut} />
      <AcademicWorkspace
        key={account.id}
        account={account}
        installation={installation}
        onLogout={signOut}
      />
      </>
    );
  if (installation?.demo && !loading)
    return <DemoLanding installation={installation} onEnter={setAccount} scanning={Boolean(lessonId)} />;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#conteudo">
        Ir para o conteúdo
      </a>
      <aside className="story" aria-label="Ping Presença">
        <a className="brand" href="/" aria-label="Ping Presença, início">
          <span className="brand-mark" aria-hidden="true">
            p<span>•</span>
          </span>
          ping presença<span className="brand-period">.</span>
        </a>
        <div className="story-copy">
          <p className="eyebrow">ABERTO À COMUNIDADE</p>
          <p className="display">
            Toda presença
            <br />
            tem uma
            <br />
            <em>história.</em>
          </p>
          <p className="intro">
            Um espaço para cuidar da presença.
            <br />
            Feito para quem ensina e para quem aprende.
          </p>
        </div>
        <div className="story-footer">
          <span className="signal" aria-hidden="true">
            ●
          </span>
          <span>Seu espaço. Sua comunidade.</span>
          <span className="edition">01 / INÍCIO</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Ping Presença</span>
          <span className="release">CHAMADA PONTA A PONTA · E2</span>
        </header>
        <main id="conteudo" className="content">
          <div className="step-label">
            <span className="step-number">{account ? '✓' : setup ? '01' : '→'}</span>
            {account ? 'SUA INSTALAÇÃO' : setup ? 'CONFIGURAÇÃO INICIAL' : 'ACESSO À INSTALAÇÃO'}
          </div>
          <h1 ref={headingRef} tabIndex={-1}>
            {loading
              ? 'Conectando seu espaço…'
              : account
                ? `Olá, ${account.name.split(' ')[0]}.`
                : setup
                  ? 'Vamos começar.'
                  : 'Bom ter você aqui.'}
          </h1>
          <p className="lead">
            {account
              ? 'A base da sua instalação está pronta.'
              : setup
                ? 'Crie a conta responsável por esta instalação. Este passo acontece uma única vez.'
                : 'Entre com sua conta para acessar a instalação.'}
          </p>
          {error && (
            <div className="message error" role="alert" tabIndex={-1} ref={errorRef}>
              {error}
              <ErrorLinks errors={fieldErrors} form={formRef.current} />
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              {notice}
            </div>
          )}
          {loading ? (
            <p role="status">Consultando o servidor…</p>
          ) : !installation ? (
            <button className="primary" onClick={() => setReload((n) => n + 1)}>
              Tentar novamente
            </button>
          ) : (
            <>
              <section className="installation-summary" aria-label="Configuração da instalação">
                <div>
                  <span className="meta-label">INSTALAÇÃO</span>
                  <strong>{installation.name}</strong>
                </div>
                <div>
                  <span className="meta-label">FUSO HORÁRIO</span>
                  <strong>{installation.timeZone}</strong>
                </div>
              </section>
              {account ? (
                <section className="ready-panel" aria-label="Conta conectada">
                  <p className="eyebrow">ACESSO CONFIRMADO</p>
                  <h2>{account.name}</h2>
                  <p>{account.email}</p>
                  <p className="role-label">
                    {account.roles.includes('OWNER')
                      ? 'Responsável pela instalação'
                      : 'Conta autenticada'}
                  </p>
                  <p className="next-note">
                    A configuração inicial foi concluída. A gestão de turmas e aulas será
                    disponibilizada na próxima entrega.
                  </p>
                  <button className="secondary" disabled={busy} onClick={() => void signOut()}>
                    {busy ? 'Saindo…' : 'Sair da conta'}
                  </button>
                </section>
              ) : setup && !installation.bootstrapAvailable ? (
                <div className="message" role="status">
                  A configuração inicial está indisponível. O responsável pela instalação precisa
                  definir o segredo inicial no servidor.
                </div>
              ) : (
                <FormValidation.Provider value={fieldErrors}>
                  <form
                    ref={formRef}
                    key={setup ? 'setup' : 'login'}
                    onSubmit={(event) => void submit(event)}
                    aria-busy={busy}
                  >
                    {setup && (
                      <FormLabel>
                        Seu nome
                        <input
                          name="name"
                          autoComplete="name"
                          minLength={2}
                          maxLength={120}
                          required
                          placeholder="Como podemos chamar você?"
                        />
                      </FormLabel>
                    )}
                    <FormLabel>
                      E-mail
                      <input
                        name="email"
                        type="email"
                        autoComplete="username"
                        maxLength={254}
                        required
                        placeholder="voce@exemplo.com"
                      />
                    </FormLabel>
                    <FormLabel>
                      Senha
                      <input
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete={setup ? 'new-password' : 'current-password'}
                        minLength={setup ? 12 : 1}
                        maxLength={128}
                        required
                        aria-describedby={setup ? 'password-hint' : undefined}
                      />
                    </FormLabel>
                    {setup && (
                      <p className="field-hint" id="password-hint">
                        Use pelo menos 12 caracteres. Uma frase longa pode ajudar.
                      </p>
                    )}
                    <FormLabel className="checkbox-label">
                      <input type="checkbox" checked={showPassword} onChange={togglePassword} />
                      Mostrar senha
                    </FormLabel>
                    {setup && (
                      <>
                        <FormLabel>
                          Confirme a senha
                          <input
                            name="confirmation"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            minLength={12}
                            maxLength={128}
                            required
                          />
                        </FormLabel>
                        <FormLabel>
                          Segredo de configuração
                          <input
                            name="secret"
                            type="password"
                            autoComplete="off"
                            maxLength={512}
                            required
                            aria-describedby="secret-hint"
                          />
                        </FormLabel>
                        <p className="field-hint" id="secret-hint">
                          Fornecido por quem instalou o sistema. É usado somente para criar a
                          primeira conta responsável.
                        </p>
                      </>
                    )}
                    <button className="primary" type="submit" disabled={busy}>
                      {busy ? 'Aguarde…' : setup ? 'Criar conta responsável' : 'Entrar'}
                      <span aria-hidden="true">↗</span>
                    </button>
                    <p className="form-note">
                      {setup
                        ? 'Seu e-mail pode ser pessoal. A criação da conta não verifica a posse do endereço.'
                        : 'Novos acessos serão concedidos pela administração. Não há cadastro público.'}
                    </p>
                  </form>
                </FormValidation.Provider>
              )}
            </>
          )}
        </main>
        <footer className="page-footer">
          <span>Software livre · AGPL-3.0-only</span>
          <span>Ping Presença / 0.4.1-demo</span>
        </footer>
      </div>
    </div>
  );
}
