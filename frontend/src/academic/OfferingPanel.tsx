import { FormLabel, ValidationGroup } from '../FormValidation';
import { History } from '../attendance/History';
import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useUiStore } from '../ui-store';
import { ActionForm, Field, ModeField, value } from './Form';
import {
  displayTime,
  localInput,
  type Catalog,
  type Lesson,
  type ManagedAccount,
  type Members,
  type Offering,
} from './types';

export function OfferingPanel({
  admin,
  offerings,
  accounts,
  catalog,
  timeZone,
  refresh,
}: {
  admin: boolean;
  offerings: Offering[];
  accounts: ManagedAccount[];
  catalog: Catalog;
  timeZone: string;
  refresh: () => Promise<void>;
}) {
  const selected = useUiStore((s) => s.offeringId),
    select = useUiStore((s) => s.selectOffering);
  const [members, setMembers] = useState<Members>({ teachers: [], enrollments: [] }),
    [lessons, setLessons] = useState<Lesson[]>([]),
    [error, setError] = useState('');
  const [editing, setEditing] = useState(''),
    [preview, setPreview] = useState<{
      lessonTitle: string;
      students: { name: string; account_id: string }[];
      policyPreview: { name: string; radius: number; geoRequired: boolean };
    } | null>(null);
  const offering = offerings.find((o) => o.id === selected),
    lesson = lessons.find((l) => l.id === editing);
  const currentSelection = useRef(selected);
  const previewRequest = useRef(0);
  currentSelection.current = selected;
  async function load() {
    if (!offering) return;
    const [l, m] = await Promise.all([
      api<Lesson[]>(`/offerings/${selected}/lessons`),
      offering.can_manage
        ? api<Members>(`/offerings/${selected}/members`)
        : Promise.resolve({ teachers: [], enrollments: [] }),
    ]);
    if (currentSelection.current !== offering.id) return;
    setLessons(l);
    setMembers(m);
    setError('');
  }
  useEffect(() => {
    let alive = true;
    previewRequest.current++;
    setLessons([]);
    setMembers({ teachers: [], enrollments: [] });
    setEditing('');
    setPreview(null);
    if (offering)
      Promise.all([
        api<Lesson[]>(`/offerings/${offering.id}/lessons`),
        offering.can_manage
          ? api<Members>(`/offerings/${offering.id}/members`)
          : Promise.resolve({ teachers: [], enrollments: [] }),
      ])
        .then(([l, m]) => {
          if (alive) {
            setLessons(l);
            setMembers(m);
            setError('');
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
      previewRequest.current++;
    };
  }, [offering?.id, offering?.version, offering?.can_manage]);
  const reload = async () => {
    await refresh();
    await load();
  };
  return (
    <section>
      <h2>Turmas e aulas</h2>
      <p className="muted">
        Planejamento no fuso <strong>{timeZone}</strong>. Criar uma aula não abre chamada.
      </p>
      <FormLabel>
        Selecionar turma
        <select value={selected} onChange={(e) => select(e.target.value)}>
          <option value="">{admin ? 'Nova turma' : 'Selecione uma turma'}</option>
          {offerings.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {o.attendance_mode === 'PILOT' ? 'Piloto' : 'Oficial'}
            </option>
          ))}
        </select>
      </FormLabel>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {!offering ? (
        admin ? (
          <div className="editor">
            <h3>Nova turma/oferta</h3>
            <ActionForm
              submit="Criar turma"
              onSave={async (data) => {
                const r = await api<{ id: string }>('/offerings', {
                  disciplineId: value(data, 'disciplineId'),
                  name: value(data, 'name'),
                  term: value(data, 'term'),
                  shift: value(data, 'shift'),
                  attendanceMode: value(data, 'attendanceMode'),
                });
                return async () => {
                  await refresh();
                  select(r.id);
                };
              }}
            >
              <FormLabel>
                Disciplina
                <select name="disciplineId" required defaultValue="">
                  <option value="">Selecione</option>
                  {catalog.disciplines.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </FormLabel>
              <Field label="Nome da turma" name="name" />
              <Field label="Período letivo" name="term" />
              <Field label="Turno" name="shift" />
              <ModeField />
            </ActionForm>
          </div>
        ) : (
          <p className="empty-state">
            Suas turmas aparecem aqui após o vínculo realizado pela administração.
          </p>
        )
      ) : (
        <Fragment key={offering.id}>
          <div className="section-heading">
            <div>
              <h3>{offering.name}</h3>
              <p>
                {offering.discipline_name} · {offering.term} · {offering.shift}
              </p>
            </div>
            <span className="badge">
              {offering.active ? 'Ativa' : 'Arquivada'} ·{' '}
              {offering.attendance_mode === 'PILOT' ? 'Piloto / teste' : 'Oficial'}
            </span>
          </div>
          {admin && (
            <details>
              <summary>Editar dados da turma</summary>
              <ActionForm
                key={`offering-${offering.id}-${offering.version}`}
                onConflict={() => void refresh()}
                onSave={async (data) => {
                  await api(`/offerings/${offering.id}`, {
                    name: value(data, 'name'),
                    term: value(data, 'term'),
                    shift: value(data, 'shift'),
                    attendanceMode: value(data, 'attendanceMode'),
                    version: offering.version,
                  });
                  return refresh;
                }}
              >
                <Field label="Nome da turma" name="name" initial={offering.name} />
                <Field label="Período letivo" name="term" initial={offering.term} />
                <Field label="Turno" name="shift" initial={offering.shift} />
                <ModeField initial={offering.attendance_mode} />
                <p>
                  A mudança de modo é padrão apenas para novas aulas. As aulas existentes não serão
                  convertidas.
                </p>
              </ActionForm>
            </details>
          )}
          {offering.can_manage && (
            <div className="columns">
              <section className="editor">
                <h3>Professores vinculados</h3>
                <ul>
                  {members.teachers.map((t) => (
                    <li key={t.account_id}>{t.name}</li>
                  ))}
                </ul>
                {!members.teachers.length && <p>Nenhum professor vinculado.</p>}
                {admin && (
                  <ActionForm
                    key={`teachers-${offering.id}-${offering.version}-${members.teachers.map((t) => t.account_id).join(',')}`}
                    submit="Salvar professores"
                    onConflict={() => void refresh()}
                    onSave={async (data) => {
                      await api(`/offerings/${offering.id}/teachers`, {
                        teacherIds: data.getAll('teacherIds'),
                        version: offering.version,
                      });
                      return reload;
                    }}
                  >
                    <ValidationGroup name="teacherIds" legend="Professores desta turma">
                      {accounts
                        .filter((a) => a.roles.includes('PROFESSOR') && a.active)
                        .map((a) => (
                          <FormLabel className="checkbox-label" key={a.id}>
                            <input
                              name="teacherIds"
                              type="checkbox"
                              value={a.id}
                              defaultChecked={members.teachers.some((t) => t.account_id === a.id)}
                            />
                            {a.name}
                          </FormLabel>
                        ))}
                    </ValidationGroup>
                  </ActionForm>
                )}
              </section>
              <section className="editor">
                <h3>Períodos de matrícula</h3>
                {members.enrollments.length === 0 && <p>Nenhum aluno matriculado.</p>}
                {members.enrollments.map((e) => (
                  <div className="member" key={`${e.id}-${e.version}`}>
                    <strong>{e.name}</strong>
                    <p>
                      {displayTime(e.enrolled_at, timeZone)} →{' '}
                      {e.ended_at ? displayTime(e.ended_at, timeZone) : 'sem término'}
                    </p>
                    {admin && e.can_end && (
                      <details>
                        <summary>Encerrar matrícula de {e.name}</summary>
                        <ActionForm
                          submit="Confirmar encerramento"
                          onConflict={() => void load()}
                          onSave={async (data) => {
                            await api(`/enrollments/${e.id}/end`, {
                              endedLocal: value(data, 'endedLocal'),
                              version: e.version,
                            });
                            return load;
                          }}
                        >
                          <Field
                            label={`Término da matrícula de ${e.name}`}
                            name="endedLocal"
                            type="datetime-local"
                          />
                          <p>O histórico permanece. Retorno exige um novo período.</p>
                        </ActionForm>
                      </details>
                    )}
                  </div>
                ))}
                {admin && (
                  <>
                    <h4>Matricular aluno</h4>
                    <ActionForm
                      submit="Matricular aluno"
                      onSave={async (data) => {
                        await api(`/offerings/${offering.id}/enrollments`, {
                          accountId: value(data, 'accountId'),
                          enrolledLocal: value(data, 'enrolledLocal'),
                          endedLocal: value(data, 'endedLocal') || null,
                        });
                        return load;
                      }}
                    >
                      <FormLabel>
                        Aluno
                        <select name="accountId" required defaultValue="">
                          <option value="">Selecione</option>
                          {accounts
                            .filter((a) => a.roles.includes('STUDENT') && a.active)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name} · {a.email}
                              </option>
                            ))}
                        </select>
                      </FormLabel>
                      <Field
                        label="Início da matrícula"
                        name="enrolledLocal"
                        type="datetime-local"
                      />
                      <Field
                        label="Término da matrícula (opcional)"
                        name="endedLocal"
                        type="datetime-local"
                        required={false}
                      />
                    </ActionForm>
                  </>
                )}
              </section>
            </div>
          )}
          <section>
            <h3>Aulas planejadas</h3>
            {!lessons.length && (
              <p className="empty-state">
                Nenhuma aula disponível neste período de matrícula ou turma.
              </p>
            )}
            <div className="lesson-grid">
              {lessons.map((l) => (
                <article className="lesson-card" key={l.id}>
                  <span className="badge">
                    {l.attendance_mode === 'PILOT' ? 'Piloto / teste — não oficial' : 'Oficial'}
                  </span>
                  <h4>{l.title}</h4>
                  {l.cancelled_at && <p className="badge">Aula cancelada — fora da frequência</p>}
                  <p>
                    {displayTime(l.starts_at, timeZone)} até {displayTime(l.ends_at, timeZone)}
                  </p>
                  <p>{l.location_name}</p>
                  <p>{l.description}</p>
                  <p>
                    <a className="action-link action-link--secondary" href={`/#attendance=${l.id}`}>
                      <span>{offering.can_manage ? 'Gerenciar chamada' : 'Acessar chamada e meu registro'}</span>
                      <span aria-hidden="true">→</span>
                    </a>
                  </p>
                  {offering.can_manage && (
                    <div className="actions">
                      <button
                        className="secondary"
                        disabled={!!l.cancelled_at}
                        onClick={() => {
                          previewRequest.current++;
                          setEditing(l.id);
                          setPreview(null);
                        }}
                      >
                        Editar {l.title}
                      </button>
                      <button
                        className="secondary"
                        onClick={async () => {
                          const request = ++previewRequest.current;
                          setPreview(null);
                          try {
                            const result = await api<NonNullable<typeof preview>>(
                              `/lessons/${l.id}/planning`,
                            );
                            if (
                              request !== previewRequest.current ||
                              currentSelection.current !== offering.id
                            )
                              return;
                            setPreview({ ...result, lessonTitle: l.title });
                            setError('');
                          } catch (e) {
                            if (
                              request !== previewRequest.current ||
                              currentSelection.current !== offering.id
                            )
                              return;
                            setError(
                              e instanceof Error ? e.message : 'Não foi possível consultar.',
                            );
                          }
                        }}
                      >
                        Elegibilidade de {l.title}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
          {offering.can_view_history && (
            <History key={offering.id} offeringId={offering.id} timeZone={timeZone} />
          )}
          {preview && (
            <section className="message" aria-label="Prévia de elegibilidade">
              <h3>Prévia de elegibilidade</h3>
              <p>Aula: {preview.lessonTitle}</p>
              <p>{preview.students.length} aluno(s), considerando o início planejado.</p>
              <ul>
                {preview.students.map((s) => (
                  <li key={s.account_id}>{s.name}</li>
                ))}
              </ul>
              <p>
                Local: {preview.policyPreview.name} · raio {preview.policyPreview.radius} m ·
                localização {preview.policyPreview.geoRequired ? 'obrigatória' : 'não obrigatória'}.
              </p>
              <p>
                Prévia da política atual, não snapshot histórico de chamada. Nenhuma presença foi
                registrada.
              </p>
            </section>
          )}
          {offering.can_manage && offering.active && (
            <section className="editor">
              <h3>{lesson ? 'Editar aula avulsa' : 'Nova aula avulsa'}</h3>
              {lesson && (
                <button className="secondary" onClick={() => setEditing('')}>
                  Voltar para nova aula
                </button>
              )}
              <ActionForm
                key={`lesson-${selected}-${lesson?.id}-${lesson?.version}`}
                submit={lesson ? 'Salvar aula' : 'Criar aula'}
                onConflict={() => void load()}
                onSave={async (data) => {
                  await api(lesson ? `/lessons/${lesson.id}` : '/lessons', {
                    offeringId: value(data, 'offeringId'),
                    locationId: value(data, 'locationId'),
                    title: value(data, 'title'),
                    description: value(data, 'description'),
                    startsLocal: value(data, 'startsLocal'),
                    endsLocal: value(data, 'endsLocal'),
                    attendanceMode: value(data, 'attendanceMode'),
                    ...(lesson ? { version: lesson.version } : {}),
                  });
                  setPreview(null);
                  previewRequest.current++;
                  return load;
                }}
              >
                <FormLabel>
                  Turma da aula
                  <select name="offeringId" defaultValue={lesson?.offering_id ?? selected}>
                    {offerings
                      .filter((o) => o.can_manage && o.active)
                      .map((o) => (
                        <option value={o.id} key={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                </FormLabel>
                <Field label="Título da aula" name="title" initial={lesson?.title} />
                <FormLabel>
                  Descrição da aula
                  <textarea
                    name="description"
                    defaultValue={lesson?.description}
                    maxLength={2000}
                  />
                </FormLabel>
                <Field
                  label={`Início da aula (${timeZone})`}
                  name="startsLocal"
                  type="datetime-local"
                  initial={lesson ? localInput(lesson.starts_at, timeZone) : ''}
                />
                <Field
                  label={`Fim da aula (${timeZone})`}
                  name="endsLocal"
                  type="datetime-local"
                  initial={lesson ? localInput(lesson.ends_at, timeZone) : ''}
                />
                <FormLabel>
                  Local autorizado
                  <select name="locationId" defaultValue={lesson?.location_id ?? ''} required>
                    <option value="">Selecione</option>
                    {catalog.locations.map((l) => (
                      <option value={l.id} key={l.id}>
                        {l.name} ·{' '}
                        {l.geo_required ? 'localização obrigatória' : 'localização não obrigatória'}
                      </option>
                    ))}
                  </select>
                </FormLabel>
                <ModeField initial={lesson?.attendance_mode ?? offering.attendance_mode} />
                <p>
                  Datas e horas são interpretadas em {timeZone}, independentemente do fuso deste
                  dispositivo. O professor não altera a política do local.
                </p>
              </ActionForm>
            </section>
          )}
        </Fragment>
      )}
    </section>
  );
}
