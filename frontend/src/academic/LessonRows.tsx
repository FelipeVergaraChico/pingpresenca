import { displayTime, type Lesson } from './types';

const states: Record<string, string> = { NOT_OPENED: 'Chamada não aberta', OPEN: 'Chamada aberta', CLOSED: 'Chamada fechada', CANCELLED: 'Aula cancelada' };
export interface LessonActions {
  manages: boolean;
  timeZone: string;
  onEdit: (lesson: Lesson) => void;
  onPreview: (lesson: Lesson) => void;
}
export function LessonRows({ lessons, manages, timeZone, onEdit, onPreview }: LessonActions & { lessons: Lesson[] }) {
  return <div className="lesson-list">
    {lessons.map((l) => <article className="lesson-card lesson-row" key={l.id}>
      <div className="lesson-row-main">
        <div className="lesson-row-badges"><span className="badge">{l.attendance_mode === 'PILOT' ? 'Piloto / teste — não oficial' : 'Oficial'}</span><span className="lesson-state">{states[l.attendance_status]}</span></div>
        <h4>{l.title}</h4>
        <p>{displayTime(l.starts_at, timeZone)} até {displayTime(l.ends_at, timeZone)}</p>
        <p className="muted">{l.location_name}</p>
        {l.description && <details><summary>Descrição da aula</summary><p>{l.description}</p></details>}
      </div>
      <div className="lesson-row-actions">
        <a className="action-link action-link--secondary" href={`/#attendance=${l.id}`}>{manages ? 'Gerenciar chamada' : 'Acessar chamada e meu registro'} <span aria-hidden="true">→</span></a>
        {manages && <div className="actions">
          <button className="secondary compact-button" disabled={!!l.cancelled_at} aria-label={`Editar ${l.title}`} onClick={() => onEdit(l)}>Editar</button>
          <button className="secondary compact-button" aria-label={`Elegibilidade de ${l.title}`} onClick={() => onPreview(l)}>Elegibilidade</button>
        </div>}
      </div>
    </article>)}
  </div>;
}
