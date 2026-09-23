import { useEffect, useRef, useState } from 'react';
import { api, type Account, type Installation } from '../api';
import { useUiStore } from '../ui-store';
import { AccountPanel } from './AccountPanel';
import { CatalogPanel } from './CatalogPanel';
import { OfferingPanel } from './OfferingPanel';
import { SettingsPanel } from './SettingsPanel';
import { AttendanceSettings } from '../attendance/Settings';
import type { Catalog, ManagedAccount, Offering } from './types';

export function AcademicWorkspace({
  account,
  installation,
  onLogout,
}: {
  account: Account;
  installation: Installation;
  onLogout: () => Promise<void>;
}) {
  const section = useUiStore((s) => s.section),
    select = useUiStore((s) => s.selectSection);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]),
    [catalog, setCatalog] = useState<Catalog>({ disciplines: [], locations: [] }),
    [offerings, setOfferings] = useState<Offering[]>([]);
  const [settings, setSettings] = useState({ institutional_id_required: false, version: 1 }),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const admin = account.roles.some((r) => ['OWNER', 'ADMIN'].includes(r)),
    staff = admin || account.roles.includes('PROFESSOR');
  const tab = admin ? section : 'offerings';
  async function refresh() {
    const [o, c, a, s] = await Promise.all([
      api<Offering[]>('/offerings'),
      staff ? api<Catalog>('/catalog') : Promise.resolve({ disciplines: [], locations: [] }),
      admin ? api<ManagedAccount[]>('/admin/accounts') : Promise.resolve([]),
      admin ? api<typeof settings>('/admin/settings') : Promise.resolve(settings),
    ]);
    setOfferings(o);
    setCatalog(c);
    setAccounts(a);
    setSettings(s);
    setError('');
  }
  useEffect(() => {
    void refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="academic-shell">
      <a className="skip-link" href="#conteudo">
        Ir para o conteúdo
      </a>
      <aside className="academic-nav">
        <a className="brand" href="/">
          ping presença.
        </a>
        <p className="eyebrow">ESPAÇO ACADÊMICO · E2</p>
        <nav aria-label="Área acadêmica">
          {(admin
            ? [
                ['offerings', 'Turmas e aulas'],
                ['accounts', 'Contas e convites'],
                ['catalog', 'Disciplinas e locais'],
                ['settings', 'Configurações'],
              ]
            : [['offerings', 'Minhas turmas']]
          ).map(([key, label]) => (
            <button
              key={key}
              aria-current={tab === key ? 'page' : undefined}
              onClick={() => {
                select(key!);
                heading.current?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="nav-footer">
          <strong>{installation.name}</strong>
          <p>{installation.timeZone}</p>
          <p>
            Preparação de aulas.
            <br />
            Chamadas e frequência em demonstração.
          </p>
        </div>
      </aside>
      <div className="academic-main">
        <header className="academic-topbar">
          <span>
            {account.name} · {account.roles.join(' + ')}
          </span>
          <button
            className="secondary"
            onClick={() => void onLogout().catch((e) => setError(e.message))}
          >
            Sair da conta
          </button>
        </header>
        <main id="conteudo">
          <p className="eyebrow">ENSINO COMEÇA COM PREPARO</p>
          <h1 ref={heading} tabIndex={-1}>
            Olá, {account.name.split(' ')[0]}.
          </h1>
          <p className="muted">
            Organize os acessos e o planejamento. Acesse a chamada pela aula correspondente.
          </p>
          {error && (
            <div className="message error" role="alert">
              {error}
              <button
                className="secondary"
                onClick={() => void refresh().catch((e) => setError(e.message))}
              >
                Tentar novamente
              </button>
            </div>
          )}
          {loading ? (
            <p role="status">Carregando sua área…</p>
          ) : tab === 'accounts' ? (
            <AccountPanel actor={account} accounts={accounts} refresh={refresh} />
          ) : tab === 'catalog' ? (
            <CatalogPanel catalog={catalog} refresh={refresh} />
          ) : tab === 'settings' ? (
            <>
              <SettingsPanel settings={settings} refresh={refresh} />
              <AttendanceSettings />
            </>
          ) : (
            <OfferingPanel
              admin={admin}
              offerings={offerings}
              accounts={accounts}
              catalog={catalog}
              timeZone={installation.timeZone}
              refresh={refresh}
            />
          )}
        </main>
        <footer className="page-footer">Software livre · AGPL-3.0-only · Ping Presença / E2</footer>
      </div>
    </div>
  );
}
