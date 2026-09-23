// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Operations } from './Operations';
import { Recovery, RecoveryIssuer } from '../Recovery';
import type { View } from './types';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const base = { lesson: { id: 'lesson' }, state: 'CLOSED', lessonVersion: 2, openingId: 'old', defaultMinutes: 10 } as View;
test('E3/A28/A76: editing retains original version through background refresh', async () => {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? response({ code: 'VERSION_CONFLICT', message: 'Registro alterado' }, 409) : response({ locations: [] }));
  vi.stubGlobal('fetch', fetch);
  const reload = vi.fn(async () => {});
  const ui = render(<Operations view={base} reload={reload} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar aula' }));
  fireEvent.change(screen.getByLabelText('Justificativa da operação'), { target: { value: 'Erro no planejamento' } });
  ui.rerender(<Operations view={{ ...base, lessonVersion: 3 }} reload={reload} />);
  fireEvent.submit(screen.getByRole('button', { name: 'Confirmar cancelamento da aula' }).closest('form')!);
  expect(await screen.findByText('Registro alterado')).toBeVisible();
  expect(JSON.parse(fetch.mock.calls.find(([,i]) => i?.method === 'POST')![1]!.body as string).version).toBe(2);
  expect(reload).not.toHaveBeenCalled();
});
test('E3/A36/A37: reopening submits current opening identifier, never a new session', async () => {
  const fetch = vi.fn(async () => response({ locations: [] })); vi.stubGlobal('fetch', fetch);
  render(<Operations view={base} reload={async () => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reabrir chamada' }));
  fireEvent.change(screen.getByLabelText('Justificativa da operação'), { target: { value: 'Nova tentativa' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Confirmar reabertura' }).closest('form')!);
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/attendance/lesson/reopen', expect.objectContaining({ body: JSON.stringify({ reason: 'Nova tentativa', openingId: 'old', minutes: 10 }) })));
});
test('E3/A59: cancelled lessons expose no reopen, relocation or cancel actions', () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ locations: [] })));
  render(<Operations view={{ ...base, state: 'CANCELLED' }} reload={async () => {}} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
test('E3/A11/A83: recovery checks confirmation locally and communicates revoked sessions', async () => {
  const fetch = vi.fn(async () => response({ name: 'Aluno teste', email: 'a@example.test' })); vi.stubGlobal('fetch', fetch);
  render(<Recovery token="private-token" />);
  await screen.findByText('Aluno teste');
  fireEvent.change(screen.getByLabelText('Nova senha', { exact: true }), { target: { value: ' synthetic-password ' } });
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'different-password' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Definir nova senha' }).closest('form')!);
  expect(await screen.findByText('As senhas não coincidem.')).toBeVisible(); expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: ' synthetic-password ' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Definir nova senha' }).closest('form')!);
  expect(await screen.findByText(/Todas as sessões anteriores foram encerradas/)).toBeVisible();
  expect(fetch).toHaveBeenLastCalledWith('/api/recovery/complete', expect.objectContaining({ body: JSON.stringify({ token: 'private-token', password: ' synthetic-password ' }) }));
});
test('E3/A11: changing selected account cannot display another account recovery link', async () => {
  let resolve!: (r: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r; })));
  const ui = render(<RecoveryIssuer key="a" accountId="a" />);
  fireEvent.change(screen.getByLabelText('Justificativa da recuperação'), { target: { value: 'Identidade conferida' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Gerar link de recuperação' }).closest('form')!);
  ui.rerender(<RecoveryIssuer key="b" accountId="b" />);
  resolve(response({ url: 'https://example.test/#recovery=private-a' }));
  await waitFor(() => expect(screen.queryByLabelText('Link privado de recuperação')).not.toBeInTheDocument());
});
