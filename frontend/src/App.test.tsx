// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from './App';
import { useUiStore } from './ui-store';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useUiStore.setState({ showPassword: false });
});
function mockApi(initialized = false) {
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/auth/me'))
      return new Response(JSON.stringify({ message: 'Entre' }), { status: 401 });
    if (options?.method === 'POST')
      return new Response(JSON.stringify({ message: 'Segredo de configuração inválido.' }), {
        status: 403,
      });
    return new Response(
      JSON.stringify({
        name: 'Instituição de teste',
        timeZone: 'America/Sao_Paulo',
        serverTime: '2026-09-10T12:00:00Z',
        initialized,
        bootstrapAvailable: true,
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
test('E0 UI: shows server configuration, labels, and password toggle without persisting credentials', async () => {
  mockApi();
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Vamos começar.' })).toBeInTheDocument();
  expect(screen.getByText('America/Sao_Paulo')).toBeInTheDocument();
  const password = screen.getByLabelText('Senha', { exact: true });
  expect(password).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByLabelText('Mostrar senha'));
  expect(password).toHaveAttribute('type', 'text');
  expect(Object.keys(useUiStore.getState()).sort()).toEqual([
    'offeringId',
    'reset',
    'section',
    'selectOffering',
    'selectSection',
    'showPassword',
    'togglePassword',
  ]);
});
test('E0 UI: server rejection is presented and does not pretend bootstrap succeeded', async () => {
  const fetch = mockApi();
  render(<App />);
  await screen.findByRole('heading', { name: 'Vamos começar.' });
  fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: 'Owner de teste' } });
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'owner@example.com' } });
  fireEvent.change(screen.getByLabelText('Senha', { exact: true }), {
    target: { value: 'test-password-long' },
  });
  fireEvent.change(screen.getByLabelText('Confirme a senha'), {
    target: { value: 'test-password-long' },
  });
  fireEvent.change(screen.getByLabelText('Segredo de configuração'), {
    target: { value: 'wrong' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Criar conta responsável' }).closest('form')!,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('Segredo de configuração inválido.');
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(fetch.mock.calls.some(([url]) => url === '/api/bootstrap')).toBe(true);
});
test('E0 UI: backend initialized flag removes public bootstrap form', async () => {
  mockApi(true);
  render(<App />);
  await screen.findByRole('heading', { name: 'Bom ter você aqui.' });
  expect(screen.queryByLabelText('Segredo de configuração')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
});

test('E1/A83: bootstrap associates server validation with fields and keeps password hints', async () => {
  const fetch = mockApi();
  const implementation = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (url, options) =>
    options?.method === 'POST'
      ? new Response(
          JSON.stringify({
            code: 'VALIDATION_ERROR',
            message: 'Corrija os campos indicados.',
            fieldErrors: [
              { field: 'password', message: 'Senha: informe pelo menos 12 caracteres.' },
            ],
          }),
          { status: 400 },
        )
      : implementation(url, options),
  );
  render(<App />);
  await screen.findByRole('heading', { name: 'Vamos começar.' });
  fireEvent.change(screen.getByLabelText('Senha', { exact: true }), { target: { value: 'short' } });
  fireEvent.change(screen.getByLabelText('Confirme a senha'), { target: { value: 'short' } });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Criar conta responsável' }).closest('form')!,
  );
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  const password = screen.getByLabelText('Senha', { exact: true });
  expect(password).toHaveValue('short');
  expect(password).toHaveAttribute('aria-invalid', 'true');
  expect(password).toHaveAccessibleDescription(
    /Use pelo menos 12 caracteres.*Senha: informe pelo menos 12 caracteres/,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Senha: informe pelo menos 12 caracteres.' }));
  expect(password).toHaveFocus();
});
