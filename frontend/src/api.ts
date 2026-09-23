export interface Installation {
  name: string;
  timeZone: string;
  serverTime: string;
  initialized: boolean;
  bootstrapAvailable: boolean;
}
export interface Account {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

export interface FieldError {
  field: string;
  message: string;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors: FieldError[] = [],
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  }).catch(() => {
    throw new ApiError(0, body === undefined
      ? 'Sem resposta do servidor. Verifique a conexão e tente atualizar.'
      : 'Sem resposta do servidor. A operação pode ter sido concluída; confira o estado atual antes de tentar novamente.');
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const fieldErrors = Array.isArray(data.fieldErrors)
      ? data.fieldErrors.filter(
          (item: unknown): item is FieldError =>
            !!item &&
            typeof item === 'object' &&
            'field' in item &&
            typeof item.field === 'string' &&
            'message' in item &&
            typeof item.message === 'string',
        )
      : [];
    throw new ApiError(
      response.status,
      data.message ?? 'Não foi possível conectar ao servidor.',
      fieldErrors,
      data.code,
    );
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
