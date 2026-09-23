import { useRef, useState } from 'react';
import { api, type Account } from '../api';
import { ActionForm, Field, value } from '../academic/Form';
import { FormLabel } from '../FormValidation';
import { displayTime } from '../academic/types';
import { sourceName, stateName, type AttendanceRecord, type View } from './types';
import { useLive } from './useLive';
import { StudentFlow } from './StudentFlow';
import { Operations } from './Operations';

export function AttendancePage({
  lessonId,
  qr,
  account,
  timeZone,
}: {
  lessonId: string;
  qr?: string;
  account: Account;
  timeZone: string;
}) {
  const { data, error, reload } = useLive<View>(`/attendance/${lessonId}`);
  const [selected, setSelected] = useState<AttendanceRecord | null>(null);
  const [reviewError, setReviewError] = useState('');
  const reviewGeneration = useRef(0);
  function selectRecord(record: AttendanceRecord | null) {
    reviewGeneration.current++;
    setSelected(record);
    setReviewError('');
  }
  const participates = account.roles.includes('STUDENT') &&
    data?.records.some((record) => record.account_id === account.id);
  return (
    <main className="attendance-page">
      <a className="action-link action-link--back" href="/">
        <span aria-hidden="true">←</span><span>Voltar à área acadêmica</span>
      </a>
      <p className="eyebrow">PING PRESENÇA · CHAMADA</p>
      <h1>{data?.lesson.title ?? 'Carregando chamada…'}</h1>
      {error && (
        <p role="alert" className="message error">
          {error} A tela pode estar desatualizada.
        </p>
      )}
      {data && (
        <>
          <p>
            {data.lesson.discipline} · {data.lesson.offering}
          </p>
          <p>
            {displayTime(data.lesson.startsAt, timeZone)} até{' '}
            {displayTime(data.lesson.endsAt, timeZone)} · {timeZone}
          </p>
          <p className="badge">
            {data.lesson.mode === 'PILOT' ? 'Piloto / teste — não oficial' : 'Oficial'}
          </p>
          <p role="status" className="message">
            {stateName(data.state)}
            {data.expiresAt ? ` · Prazo: ${displayTime(data.expiresAt, timeZone)}` : ''}
          </p>
          {data.manages ? (
            <>
              {data.state === 'NOT_OPENED' && (
                <ActionForm
                  submit="Abrir chamada"
                  onSave={async (form) => {
                    await api(`/attendance/${lessonId}/open`, {
                      minutes: Number(value(form, 'minutes')),
                      ...(data.administrative ? { reason: value(form, 'reason') } : {}),
                    });
                    return async () => {
                      await reload();
                    };
                  }}
                >
                  <Field
                    label="Duração da chamada (minutos)"
                    name="minutes"
                    type="number"
                    min={1}
                    max={1440}
                    initial={data.defaultMinutes}
                  />
                  {data.administrative && (
                    <Field label="Justificativa administrativa" name="reason" />
                  )}
                  <p>O prazo nunca ultrapassa o término planejado da aula.</p>
                </ActionForm>
              )}
              {data.state === 'OPEN' && (
                <>
                  <p>
                    <a
                      className="action-link action-link--primary"
                      href={`/#project=${lessonId}`}
                      target="_blank"
                      rel="noopener"
                    >
                      <span>Abrir tela exclusiva de projeção</span><span aria-hidden="true">↗</span>
                    </a>
                  </p>
                  <ActionForm
                    key={data.openingId}
                    submit="Fechar chamada"
                    onConflict={() => void reload()}
                    onSave={async (form) => {
                      await api(
                        `/attendance/${lessonId}/close`,
                        { openingId: data.openingId, ...(data.administrative ? { reason: value(form, 'reason') } : {}) },
                      );
                      return reload;
                    }}
                  >
                    {data.administrative && (
                      <Field label="Justificativa administrativa do fechamento" name="reason" />
                    )}
                    <p>Alunos sem presença ou pendência receberão ausência automática.</p>
                  </ActionForm>
                </>
              )}
              <Operations view={data} reload={reload} />
              <section aria-label="Acompanhamento da chamada">
                <h2>Alunos elegíveis</h2>
                <ul className="attendance-list">
                  {data.records.map((r) => (
                    <li key={r.account_id}>
                      <div>
                        <strong>{r.name}</strong>
                        <p>
                          {stateName(r.status)} · {sourceName(r.source)}
                        </p>
                      </div>
                      {data.state !== 'NOT_OPENED' && (
                        <button className="secondary" onClick={() => selectRecord({ ...r })}>
                          Analisar {r.name}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              {selected && (
                <section className="editor" aria-label={`Análise de ${selected.name}`}>
                  <h2>{selected.name}</h2>
                  <p>
                    Estado em análise: {stateName(selected.status)} · versão {selected.version}
                  </p>
                  {reviewError && <p role="alert">{reviewError}</p>}
                  <p>
                    Uma decisão resolve todas as pendências apresentadas deste aluno nesta aula.
                    Confira a cronologia abaixo antes de decidir.
                  </p>
                  <ActionForm
                    key={`${selected.account_id}-${selected.version}`}
                    submit="Aplicar decisão justificada"
                    onConflict={() => {
                      const generation = reviewGeneration.current;
                      void api<View>(`/attendance/${lessonId}`)
                        .then((v) => {
                          if (generation !== reviewGeneration.current) return;
                          selectRecord(
                            v.records.find((r) => r.account_id === selected.account_id) ?? null,
                          );
                          setReviewError('');
                        })
                        .catch(() => {
                          if (generation !== reviewGeneration.current) return;
                          setReviewError(
                            'Não foi possível atualizar. Mantenha a conexão e tente novamente.',
                          );
                        });
                    }}
                    onSave={async (form) => {
                      const generation = reviewGeneration.current;
                      await api(`/attendance/${lessonId}/decision`, {
                        accountId: selected.account_id,
                        version: selected.version,
                        kind:
                          selected.status === 'PENDING'
                            ? 'PENDING_DECISION'
                            : !selected.status || (selected.source === 'AUTO_CLOSE' && value(form, 'status') === 'PRESENT')
                              ? 'MANUAL'
                              : 'CORRECTION',
                        status: value(form, 'status'),
                        reason: value(form, 'reason'),
                      });
                      return async () => {
                        await reload();
                        if (generation === reviewGeneration.current) selectRecord(null);
                      };
                    }}
                  >
                    <FormLabel>
                      Resultado da decisão
                      <select name="status" defaultValue="PRESENT">
                        <option value="PRESENT">Presença</option>
                        {!!selected.status && (
                          <option value="ABSENT">Ausência</option>
                        )}
                      </select>
                    </FormLabel>
                    <Field label="Justificativa da decisão" name="reason" maxLength={1000} />
                  </ActionForm>
                  <button className="secondary" onClick={() => selectRecord(null)}>
                    Cancelar análise
                  </button>
                  <h3>Tentativas em ordem cronológica</h3>
                  <ol>
                    {data.attempts
                      .filter((t) => t.account_id === selected.account_id)
                      .map((t) => (
                        <li key={t.id}>
                          {displayTime(t.recorded_at, timeZone)} · {stateName(t.outcome)} ·{' '}
                          {t.message}
                          {t.distance !== null && (
                            <span>
                              {' '}
                              Distância: {Math.round(t.distance)} m; precisão: {t.accuracy} m.
                            </span>
                          )}
                          {t.resolution && (
                            <span> Pendência resolvida/superada: {t.resolution}.</span>
                          )}
                        </li>
                      ))}
                  </ol>
                </section>
              )}
              <details>
                <summary>Auditoria da aula</summary>
                <ol>
                  {data.audit.map((e) => (
                    <li key={e.id}>
                      <strong>{e.action}</strong> · {displayTime(e.occurred_at, timeZone)} ·{' '}
                      {e.actor_role ?? e.actor_kind}
                      <p>Responsável: {e.actor_id ?? 'Sistema'}</p>
                      <pre>{JSON.stringify(e.details, null, 2)}</pre>
                    </li>
                  ))}
                </ol>
              </details>
            </>
          ) : null}
          {participates && (
            <>
              {data.state === 'OPEN' && (
                <StudentFlow
                  lessonId={lessonId}
                  qr={qr}
                  account={account}
                  timeZone={timeZone}
                  onResult={reload}
                />
              )}
              <h2>Meu registro atual</h2>
              {data.records.filter((r) => r.account_id === account.id).map((r) => (
                <p key={r.account_id}>
                  {stateName(r.status)} · {sourceName(r.source)}
                </p>
              ))}
              <h2>Minhas tentativas</h2>
              <ol>
                {data.attempts.filter((t) => t.account_id === account.id).map((t) => (
                  <li key={t.id}>
                    {displayTime(t.recorded_at, timeZone)} · {stateName(t.outcome)} — {t.message}
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </main>
  );
}
