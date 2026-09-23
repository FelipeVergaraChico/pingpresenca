import type { z } from 'zod';

export interface FieldError {
  field: string;
  message: string;
}
// Only public form fields are returned. Never serialize Zod input, unknown keys,
// SQL details or submitted values (which may contain passwords/tokens).
const labels: Record<string, string> = {
  minutes: 'Duração da chamada (minutos)',
  code: 'Código da chamada',
  geo: 'Localização',
  status: 'Resultado',
  kind: 'Tipo de decisão',
  name: 'Nome',
  email: 'E-mail',
  password: 'Senha',
  secret: 'Segredo de configuração',
  institutionalId: 'Identificador institucional',
  roles: 'Papéis',
  reason: 'Justificativa',
  description: 'Descrição',
  latitude: 'Latitude',
  longitude: 'Longitude',
  radius: 'Raio permitido',
  geoRequired: 'Geolocalização obrigatória',
  disciplineId: 'Disciplina',
  term: 'Período letivo',
  shift: 'Turno',
  attendanceMode: 'Modo de presença',
  offeringId: 'Turma',
  locationId: 'Local',
  title: 'Título',
  startsLocal: 'Início da aula',
  endsLocal: 'Fim da aula',
  enrolledLocal: 'Início da matrícula',
  endedLocal: 'Término da matrícula',
  accountId: 'Aluno',
  teacherIds: 'Professores',
  institutionalIdRequired: 'Política de cadastro',
};

export function validationErrors(issues: z.core.$ZodIssue[]): FieldError[] {
  const result = new Map<string, string>();
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '');
    const label = labels[field];
    if (!label) continue;
    let message = 'Revise o valor informado.';
    if (issue.code === 'too_small' || issue.code === 'too_big') {
      const small = issue.code === 'too_small';
      const limit = small ? issue.minimum : issue.maximum;
      if (issue.origin === 'string')
        message = small
          ? `Informe pelo menos ${limit} caracteres.`
          : `Use no máximo ${limit} caracteres.`;
      else if (issue.origin === 'array')
        message = small
          ? `Selecione pelo menos ${limit} ${Number(limit) === 1 ? 'opção' : 'opções'}.`
          : `Selecione no máximo ${limit} ${Number(limit) === 1 ? 'opção' : 'opções'}.`;
      else
        message = `Informe um número ${small ? (issue.inclusive ? 'maior ou igual a' : 'maior que') : issue.inclusive ? 'menor ou igual a' : 'menor que'} ${limit}.`;
    } else if (issue.code === 'invalid_format') {
      message =
        field === 'email' ? 'Informe um endereço de e-mail válido.' : 'Selecione uma opção válida.';
    } else if (issue.code === 'invalid_type') {
      message =
        issue.expected === 'number'
          ? 'Informe um número válido.'
          : 'Preencha este campo com um valor válido.';
    } else if (issue.code === 'invalid_value') message = 'Selecione uma opção válida.';
    else if (field === 'roles' || field === 'teacherIds')
      message = 'Selecione opções válidas, sem repetições.';
    if (!result.has(field)) result.set(field, `${label}: ${message}`);
  }
  return Array.from(result, ([field, message]) => ({ field, message }));
}
