// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { StudentFlow } from './StudentFlow';
import { Projection } from './Projection';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const account = {
  id: 'student',
  name: 'Aluna teste',
  email: 'student@example.test',
  roles: ['STUDENT'],
};
const lesson = {
  id: 'lesson',
  offering: 'Programação',
  title: 'Aula teste',
  discipline: 'Disciplina',
  mode: 'PILOT',
  startsAt: '2026-09-22T19:00:00Z',
  endsAt: '2026-09-22T21:00:00Z',
};
const auth = () => ({
  token: 'authorization',
  lesson,
  geoRequired: true,
  serverNow: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
});
const response = (data: unknown) => new Response(JSON.stringify(data));
test('A38/A40/A42: QR authorization is not attendance; location only after explicit confirmation', async () => {
  const geo = vi.fn((_success: unknown, error: (e: { code: number }) => void) =>
    error({ code: 1 }),
  );
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: geo } });
  const fetch = vi.fn(async (url: string) =>
    response(
      url.endsWith('/authorize')
        ? auth()
        : { outcome: 'PENDING', message: 'Localização não pôde ser validada.' },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  render(
    <StudentFlow
      lessonId="lesson"
      qr="challenge"
      account={account}
      timeZone="America/Sao_Paulo"
      onResult={async () => {}}
    />,
  );
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole('button', { name: 'Validar QR ou código' }).closest('form')!);
  const confirm = await screen.findByRole('button', {
    name: 'Confirmar minha presença',
  });
  expect(geo).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  expect(await screen.findByText('Localização não pôde ser validada.')).toBeInTheDocument();
  expect(geo).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.getByRole('status')).toHaveFocus());
});
test('A41/A85: uncertain response uses read-only result lookup without retaining or resending location', async () => {
  const geo = vi.fn((success: (p: unknown) => void) =>
    success({ coords: { latitude: -23, longitude: -46, accuracy: 5 } }),
  );
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: geo } });
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/confirm')) throw new Error('Sem conexão');
    return response(
      url.endsWith('/authorize')
        ? auth()
        : { outcome: 'ACCEPTED', message: 'Presença registrada.' },
    );
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <StudentFlow
      lessonId="lesson"
      qr="challenge"
      account={account}
      timeZone="America/Sao_Paulo"
      onResult={async () => {}}
    />,
  );
  fireEvent.submit(screen.getByRole('button', { name: 'Validar QR ou código' }).closest('form')!);
  const confirm = await screen.findByRole('button', {
    name: 'Confirmar minha presença',
  });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Consultar resultado sem reenviar localização',
    }),
  );
  await screen.findByText('Presença registrada.');
  const call = fetch.mock.calls.find(([url]) => url.endsWith('/result'))!;
  expect(JSON.parse(String(call[1]?.body))).toEqual({ token: 'authorization' });
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/confirm'))).toHaveLength(1);
  expect(geo).toHaveBeenCalledOnce();
});
test('A35/A86: closed projection has no code or individual data', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response({ lesson, open: false, serverNow: new Date().toISOString() })),
  );
  render(<Projection lessonId="lesson" />);
  await screen.findByText('Chamada encerrada ou não iniciada');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByText('Código para digitar na chamada')).not.toBeInTheDocument();
  expect(screen.queryByText(account.name)).not.toBeInTheDocument();
});
