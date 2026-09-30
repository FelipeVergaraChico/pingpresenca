// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useLive, useRemaining } from './useLive';
import { api } from '../api';

vi.mock('../api', () => ({ api: vi.fn() }));
const mockedApi = vi.mocked(api);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  mockedApi.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('A72 parcial: polling aguarda resposta anterior e para ao desmontar', async () => {
  const request = deferred<{ state: string }>();
  mockedApi.mockReturnValue(request.promise);
  const { result, unmount } = renderHook(() => useLive('/lesson', 1000));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(mockedApi).toHaveBeenCalledTimes(1);
  await act(async () => { request.resolve({ state: 'OPEN' }); });
  expect(result.current.data).toEqual({ state: 'OPEN' });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(mockedApi).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(mockedApi).toHaveBeenCalledTimes(2);
});

test('Atualização: resposta antiga não substitui recurso selecionado nem agenda novo polling', async () => {
  const old = deferred<unknown>();
  mockedApi.mockReturnValueOnce(old.promise).mockResolvedValue({ id: 'new' });
  const { result, rerender } = renderHook(({ path }) => useLive(path, 1000),
    { initialProps: { path: '/old' } });
  await act(async () => { rerender({ path: '/new' }); });
  expect(result.current.data).toEqual({ id: 'new' });
  await act(async () => { old.resolve({ id: 'old' }); });
  expect(result.current.data).toEqual({ id: 'new' });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(mockedApi.mock.calls.map(([path]) => path)).toEqual(['/old', '/new', '/new']);
});

test('A72 parcial: falha de sincronização é exibida e recuperação limpa o erro', async () => {
  mockedApi.mockRejectedValueOnce(new Error('Servidor indisponível')).mockResolvedValue({ state: 'CLOSED' });
  const { result } = renderHook(() => useLive('/lesson', 1000));
  await act(async () => {});
  expect(result.current.error).toBe('Servidor indisponível');
  expect(result.current.data).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(result.current.error).toBe('');
  expect(result.current.data).toEqual({ state: 'CLOSED' });
});

test('A79 parcial: contador usa tempo monotônico, não relógio civil do dispositivo', () => {
  let monotonic = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
  const { result, rerender } = renderHook(({ deadline }) =>
    useRemaining('2026-09-30T12:00:00Z', deadline),
  { initialProps: { deadline: '2026-09-30T12:00:10Z' as string | undefined } });
  expect(result.current).toBe(10);
  vi.setSystemTime(new Date('2099-01-01'));
  monotonic += 1250;
  act(() => vi.advanceTimersByTime(250));
  expect(result.current).toBe(9);
  monotonic += 20000;
  act(() => vi.advanceTimersByTime(250));
  expect(result.current).toBe(0);
  rerender({ deadline: undefined });
  expect(result.current).toBe(0);
});

test('A81 parcial: prazo ausente ou vencido não apresenta tempo positivo', () => {
  const { result } = renderHook(() => useRemaining('2026-09-30T12:00:00Z', '2026-09-30T11:59:59Z'));
  expect(result.current).toBe(0);
  const missing = renderHook(() => useRemaining(undefined, undefined));
  expect(missing.result.current).toBe(0);
});
