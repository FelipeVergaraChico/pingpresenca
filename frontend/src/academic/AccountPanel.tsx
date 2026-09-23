import { FormLabel, ValidationGroup } from '../FormValidation';
import { useState } from 'react';
import { api, type Account } from '../api';
import { ActionForm, Field, value } from './Form';
import type { ManagedAccount } from './types';
import { RecoveryIssuer } from '../Recovery';

export function AccountPanel({
  actor,
  accounts,
  refresh,
}: {
  actor: Account;
  accounts: ManagedAccount[];
  refresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState(''),
    [link, setLink] = useState('');
  const target = accounts.find((a) => a.id === selected),
    owner = actor.roles.includes('OWNER');
  const editable = target && (owner || !target.roles.some((r) => ['OWNER', 'ADMIN'].includes(r)));
  const roleFields = (current: string[] = []) => (
    <ValidationGroup name="roles" legend="Papéis">
      {[
        ['STUDENT', 'Aluno'],
        ['PROFESSOR', 'Professor'],
        ...(owner ? [['ADMIN', 'Administrador']] : []),
      ]
        .filter(([r]) => !(target?.roles.includes('OWNER') && r === 'ADMIN'))
        .map(([r, label]) => (
          <FormLabel className="checkbox-label" key={r}>
            <input name="roles" type="checkbox" value={r} defaultChecked={current.includes(r!)} />
            {label}
          </FormLabel>
        ))}
    </ValidationGroup>
  );
  return (
    <section>
      <h2>Contas e convites</h2>
      <p className="muted">
        Cadastre, atribua os vínculos na turma e só então entregue o convite. Nenhum e-mail é
        enviado nesta entrega.
      </p>
      <FormLabel>
        Selecionar conta
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setLink('');
          }}
        >
          <option value="">Nova conta</option>
          {accounts.map((a) => (
            <option value={a.id} key={a.id}>
              {a.name} · {a.email}
            </option>
          ))}
        </select>
      </FormLabel>
      {!target ? (
        <div className="editor" key="new">
          <h3>Nova conta</h3>
          <ActionForm
            submit="Cadastrar conta"
            onSave={async (data) => {
              const created = await api<{ id: string }>('/admin/accounts', {
                name: value(data, 'name'),
                email: value(data, 'email'),
                institutionalId: value(data, 'institutionalId') || null,
                roles: data.getAll('roles'),
              });
              return async () => {
                await refresh();
                setSelected(created.id);
              };
            }}
          >
            <Field label="Nome completo" name="name" maxLength={120} />
            <Field label="E-mail da conta" name="email" type="email" maxLength={254} />
            <Field
              label="Identificador institucional"
              name="institutionalId"
              required={false}
              maxLength={80}
            />
            {roleFields()}
            <p className="muted">
              O backend exige o identificador quando a política da instalação o torna obrigatório. A
              senha será escolhida pela pessoa no convite.
            </p>
          </ActionForm>
        </div>
      ) : (
        <div className="editor" key={`${target.id}-${target.version}`}>
          <h3>{target.name}</h3>
          <p>{target.email}</p>
          <p className="badge">
            {target.roles.join(' + ')} ·{' '}
            {target.accepted ? 'Acesso ativado' : 'Aguardando convite/aceite'}
          </p>
          <p>E-mail {target.email_verified_at ? 'verificado' : 'não verificado'}</p>
          {editable && target.accepted && !target.roles.includes('OWNER') && <RecoveryIssuer key={target.id} accountId={target.id} />}
          {editable ? (
            <>
              <ActionForm
                onConflict={() => void refresh()}
                onSave={async (data) => {
                  await api(`/admin/accounts/${target.id}/profile`, {
                    name: value(data, 'name'),
                    institutionalId: value(data, 'institutionalId') || null,
                    version: target.version,
                    reason: value(data, 'reason'),
                  });
                  return refresh;
                }}
              >
                <Field label="Nome completo" name="name" initial={target.name} />
                <Field
                  label="Identificador institucional"
                  name="institutionalId"
                  initial={target.institutional_id ?? ''}
                  required={false}
                />
                <Field label="Justificativa da edição" name="reason" maxLength={1000} />
              </ActionForm>
              <h3>Alterar papéis</h3>
              <ActionForm
                submit="Salvar papéis"
                onConflict={() => void refresh()}
                onSave={async (data) => {
                  await api(`/admin/accounts/${target.id}/roles`, {
                    roles: data.getAll('roles'),
                    version: target.version,
                    reason: value(data, 'reason'),
                  });
                  setLink('');
                  return refresh;
                }}
              >
                {roleFields(target.roles)}
                <Field label="Justificativa dos papéis" name="reason" maxLength={1000} />
                <p className="muted">
                  OWNER é preservado. Alterar papéis invalida convites pendentes: gere outro depois
                  de revisar os vínculos.
                </p>
              </ActionForm>
              {!target.accepted && (
                <>
                  <h3>Convite manual</h3>
                  <p>
                    O novo link invalida qualquer convite anterior. Entregue somente à pessoa
                    identificada acima.
                  </p>
                  <ActionForm
                    submit="Gerar link de convite"
                    success="Link gerado. Copie e entregue por um canal confiável."
                    onSave={async () => {
                      setLink('');
                      const result = await api<{ url: string }>(
                        `/admin/accounts/${target.id}/invitations`,
                        {},
                      );
                      setLink(result.url);
                    }}
                  >
                    <p>Validade: 48 horas. Uso único. Não verifica a posse do e-mail.</p>
                  </ActionForm>
                </>
              )}
            </>
          ) : (
            <p className="message">Esta conta administrativa só pode ser gerenciada pelo owner.</p>
          )}
        </div>
      )}
      {link && (
        <FormLabel className="invite-link">
          Link individual de convite (copie antes de sair)
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
        </FormLabel>
      )}
    </section>
  );
}
