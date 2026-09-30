import { afterEach, expect, test, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => vi.unstubAllGlobals());

test('HTTP: GET usa sessão da mesma origem e não envia corpo', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ready: true })));
  vi.stubGlobal('fetch', fetch);
  expect(await api('/installation')).toEqual({ ready: true });
  expect(fetch).toHaveBeenCalledWith('/api/installation', expect.objectContaining({
    method: 'GET', credentials: 'same-origin', body: undefined, signal: expect.any(AbortSignal),
  }));
});

test('HTTP: POST serializa o código como texto, preservando zeros à esquerda', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  expect(await api('/attendance/lesson/authorize', { code: '001234' })).toBeUndefined();
  expect(fetch).toHaveBeenCalledWith('/api/attendance/lesson/authorize', expect.objectContaining({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"code":"001234"}',
  }));
});

test('A83 parcial: erro HTTP preserva mensagem, código e apenas erros de campo válidos', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    code: 'INVALID_INPUT', message: 'Informe uma data válida.',
    fieldErrors: [null, 'invalid', { field: 1, message: 'invalid' },
      { field: 'date', message: 'Data inválida.' }],
  }), { status: 400 })));
  await expect(api('/lessons', {})).rejects.toMatchObject({ status: 400, code: 'INVALID_INPUT',
    message: 'Informe uma data válida.', fieldErrors: [{ field: 'date', message: 'Data inválida.' }] });
});

for (const body of ['<html>Gateway indisponível</html>', 'null', '42', '[]',
  '{"message":{"internal":"private"},"code":123,"fieldErrors":{}}']) {
  test(`HTTP: resposta de erro inesperada ${body} mantém ApiError compreensível`, async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 502 })));
    await expect(api('/installation')).rejects.toBeInstanceOf(ApiError);
    await expect(api('/installation')).rejects.toMatchObject({ status: 502,
      message: 'Não foi possível conectar ao servidor.', fieldErrors: [], code: undefined });
  });
}

test('HTTP: falha de leitura orienta atualizar, sem vazar erro interno da rede', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('private network details'));
  vi.stubGlobal('fetch', fetch);
  await expect(api('/installation')).rejects.toMatchObject({ status: 0,
    message: 'Sem resposta do servidor. Verifique a conexão e tente atualizar.' });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('HTTP: falha de escrita alerta sobre resultado incerto e não repete a operação', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('timeout'));
  vi.stubGlobal('fetch', fetch);
  await expect(api('/attendance/lesson/confirm', {})).rejects.toMatchObject({ status: 0,
    message: expect.stringContaining('A operação pode ter sido concluída') });
  expect(fetch).toHaveBeenCalledTimes(1);
});
