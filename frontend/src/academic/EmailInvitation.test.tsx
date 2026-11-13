// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Invitation } from '../Invitation';
import { AccountPanel } from './AccountPanel';
import { api } from '../api';
vi.mock('../api', async original => ({ ...await original<object>(), api: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const account = { id: 'student', name: 'Pessoa Teste', email: 'student@example.com', roles: ['STUDENT'], active: true, accepted: false, institutional_id: null, email_verified_at: null, version: 1 };
const actor = { ...account, id: 'owner', roles: ['OWNER'] };
it('A09: aceite por e-mail mostra verificação e envia apenas token e senha', async () => {
  vi.mocked(api).mockResolvedValueOnce({ name: account.name, email: account.email, channel: 'EMAIL' }).mockResolvedValueOnce({ accepted: true });
  render(<Invitation token="test-token" />);
  await screen.findByText(/Convite enviado por e-mail/);
  fireEvent.change(screen.getByLabelText('Nova senha', { exact: true }), { target: { value: 'synthetic-password' } });
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'synthetic-password' } });
  fireEvent.submit(screen.getByText('Aceitar convite e definir senha').closest('form')!);
  await screen.findByText(/seu e-mail foi verificado/);
  expect(api).toHaveBeenLastCalledWith('/invitations/accept', { token: 'test-token', password: 'synthetic-password' });
});
it('A09: sem SMTP mantém convite manual e não oferece envio', async () => {
  vi.mocked(api).mockResolvedValue({ enabled: false });
  render(<AccountPanel actor={actor} accounts={[account]} refresh={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Selecionar conta'), { target: { value: account.id } });
  await screen.findByText(/SMTP não configurado/);
  expect(screen.getByText('Gerar link de convite')).toBeTruthy();
  expect(screen.queryByText('Enviar convite por e-mail')).toBeNull();
});
it('A09: envio exige ação explícita, não retorna link e falha não anuncia sucesso', async () => {
  vi.mocked(api).mockResolvedValueOnce({ enabled: true }).mockRejectedValueOnce(new Error('Falha SMTP simulada'));
  render(<AccountPanel actor={actor} accounts={[account]} refresh={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Selecionar conta'), { target: { value: account.id } });
  const button = await screen.findByText('Enviar convite por e-mail');
  expect(api).toHaveBeenCalledTimes(1);
  fireEvent.submit(button.closest('form')!);
  await screen.findByText('Falha SMTP simulada');
  expect(api).toHaveBeenLastCalledWith('/admin/accounts/student/email-invitations', {});
  expect(screen.queryByText(/Convite aceito pelo servidor/)).toBeNull();
});
