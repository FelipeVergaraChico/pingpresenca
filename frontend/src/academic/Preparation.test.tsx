// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Invitation } from '../Invitation';
import { ActionForm } from './Form';
import { localInput, displayTime } from './types';
import { ApiError } from '../api';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test('A07/A09 UI: manual invitation identifies account and never submits client roles', async () => {
  const fetch = vi.fn(
    async (_url: string, options?: RequestInit) =>
      new Response(
        JSON.stringify(
          options?.body?.toString().includes('password')
            ? { accepted: true }
            : { name: 'Aluna teste', email: 'aluna@example.com', channel: 'MANUAL' },
        ),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  render(<Invitation token={'a'.repeat(43)} />);
  expect(await screen.findByText('aluna@example.com')).toBeInTheDocument();
  expect(screen.getByText(/não comprova posse/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Nova senha', { exact: true }), {
    target: { value: 'long-test-password' },
  });
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), {
    target: { value: 'long-test-password' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Aceitar convite e definir senha' }).closest('form')!,
  );
  await screen.findByRole('heading', { name: 'Cadastro concluído.' });
  const accepted = fetch.mock.calls.find(([url]) => url === '/api/invitations/accept');
  expect(JSON.parse(String(accepted?.[1]?.body))).toEqual({
    token: 'a'.repeat(43),
    password: 'long-test-password',
  });
});
test('E1 UI: conflict does not report success and offers deliberate refresh', async () => {
  const refresh = vi.fn();
  render(
    <ActionForm
      onConflict={refresh}
      onSave={async () => {
        throw new ApiError(409, 'O registro foi alterado.', [], 'VERSION_CONFLICT');
      }}
    >
      <input aria-label="Título" />
    </ActionForm>,
  );
  fireEvent.submit(screen.getByRole('button', { name: 'Salvar' }).closest('form')!);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar dados para revisão' }));
  expect(refresh).toHaveBeenCalledOnce();
});
test('A80 UI: datetime inputs and presentation use installation timezone', () => {
  expect(localInput('2026-09-11T02:30:00Z', 'America/Sao_Paulo')).toBe('2026-09-10T23:30');
  expect(displayTime('2026-09-11T02:30:00Z', 'America/Sao_Paulo')).toContain('23:30');
});
test('E1 invitation: password confirmation preserves whitespace exactly', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ name: 'Aluna', email: 'aluna@example.com', channel: 'MANUAL' }),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  render(<Invitation token={'b'.repeat(43)} />);
  await screen.findByText('aluna@example.com');
  fireEvent.change(screen.getByLabelText('Nova senha', { exact: true }), {
    target: { value: ' long-test-password' },
  });
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), {
    target: { value: 'long-test-password' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Aceitar convite e definir senha' }).closest('form')!,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('As senhas não coincidem.');
  expect(fetch).toHaveBeenCalledTimes(1);
});
