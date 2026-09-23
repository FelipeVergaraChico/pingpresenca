// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AttendanceSettings } from './Settings';
import { ApiError } from '../api';

const state = vi.hoisted(() => ({ data: { minutes: 10, version: 1 }, api: vi.fn(), reload: vi.fn() }));
vi.mock('../api', async (original) => ({ ...await original<object>(), api: state.api }));
vi.mock('./useLive', () => ({
  useLive: () => ({ data: state.data, error: '', reload: state.reload }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  state.data = { minutes: 10, version: 1 };
  state.api.mockResolvedValue({ updated: true });
  state.reload.mockResolvedValue(undefined);
});
afterEach(cleanup);

test('E2: a remotely updated policy must not silently discard an administrator draft', () => {
  const page = render(<AttendanceSettings />);
  fireEvent.change(screen.getByLabelText('Duração padrão da chamada (minutos)'), { target: { value: '15' } });
  fireEvent.change(screen.getByLabelText('Justificativa da política de chamada'), { target: { value: 'Ajuste em preparação pelo administrador A' } });
  // Simulate the next poll returning administrator B's completed update.
  state.data = { minutes: 20, version: 2 };
  page.rerender(<AttendanceSettings />);
  expect((screen.getByLabelText('Justificativa da política de chamada') as HTMLInputElement).value)
    .toBe('Ajuste em preparação pelo administrador A');
  expect((screen.getByLabelText('Duração padrão da chamada (minutos)') as HTMLInputElement).value)
    .toBe('15');
});

test('remote update requires conscious review before sending the new version with the preserved draft', async () => {
  const page = render(<AttendanceSettings />);
  fireEvent.change(screen.getByLabelText('Duração padrão da chamada (minutos)'), { target: { value: '15' } });
  fireEvent.change(screen.getByLabelText('Justificativa da política de chamada'), { target: { value: 'Alteração justificada' } });
  state.data = { minutes: 20, version: 2 };
  page.rerender(<AttendanceSettings />);
  await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Salvar' }).closest('form')!); });
  expect(state.api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Revisei a versão atual; manter meu rascunho' }));
  await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Salvar' }).closest('form')!); });
  expect(state.api).toHaveBeenCalledWith('/attendance/settings', { minutes: 15, reason: 'Alteração justificada', version: 2 });
});

test('server conflict preserves the draft and refresh does not silently adopt a newer version', async () => {
  state.api.mockRejectedValueOnce(new ApiError(409, 'Versão alterada', [], 'VERSION_CONFLICT'));
  const page = render(<AttendanceSettings />);
  fireEvent.change(screen.getByLabelText('Justificativa da política de chamada'), { target: { value: 'Meu rascunho' } });
  await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Salvar' }).closest('form')!); });
  expect(state.api).toHaveBeenCalledWith('/attendance/settings', { minutes: 10, reason: 'Meu rascunho', version: 1 });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Atualizar dados para revisão' })); });
  expect(state.reload).toHaveBeenCalledTimes(1);
  state.data = { minutes: 20, version: 2 };
  page.rerender(<AttendanceSettings />);
  expect((screen.getByLabelText('Justificativa da política de chamada') as HTMLInputElement).value).toBe('Meu rascunho');
  expect(screen.queryByRole('button', { name: 'Revisei a versão atual; manter meu rascunho' })).not.toBeNull();
});

test('saved write is not repeated when refreshing fails', async () => {
  state.reload.mockRejectedValueOnce(new Error('offline'));
  render(<AttendanceSettings />);
  fireEvent.change(screen.getByLabelText('Justificativa da política de chamada'), { target: { value: 'Justificativa' } });
  await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Salvar' }).closest('form')!); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Atualizar lista' })); });
  expect(state.api).toHaveBeenCalledTimes(1);
  expect(state.reload).toHaveBeenCalledTimes(2);
});
