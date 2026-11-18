// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api, ApiError } from '../api';
import { AccountPanel } from './AccountPanel';
import { OfferingPanel } from './OfferingPanel';
import { useUiStore } from '../ui-store';
vi.mock('../api', async original => ({ ...await original<object>(), api: vi.fn() }));
vi.mock('./LessonList', () => ({ LessonList: () => <p>Lista de aulas preservada</p> }));
vi.mock('./RecurrencePanel', () => ({ RecurrencePanel: () => <p>Programar aulas</p> }));
const account = { id: 'student', name: 'Aluno Teste', email: 'student@example.test', roles: ['STUDENT'], active: true, accepted: true, institutional_id: null, email_verified_at: null, version: 4, active_enrollment_count: 2 };
const owner = { id: 'owner', name: 'Owner', email: 'owner@example.test', roles: ['OWNER'] };
const offering = { id: 'offering', name: 'Turma teste', discipline_id: 'discipline', discipline_name: 'Disciplina', term: '2026', shift: 'Noite', attendance_mode: 'PILOT', active: true, can_manage: true, version: 2 };
beforeEach(() => { vi.mocked(api).mockImplementation(async path => path === '/admin/mail-status' ? { enabled: false } : { teachers: [], enrollments: [] }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); useUiStore.getState().selectOffering(''); });
it('A16/A17: desativação mostra consequência e envia motivo, versão e matrículas revisadas', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<AccountPanel actor={owner} accounts={[account]} refresh={refresh} />);
  fireEvent.change(screen.getByLabelText('Selecionar conta'), { target: { value: account.id } });
  fireEvent.click(screen.getByText('Desativar acesso da conta'));
  expect(screen.getByText(/possui 2 matrícula/)).toHaveTextContent(/poderá receber faltas/);
  fireEvent.change(screen.getByLabelText('Justificativa da alteração de acesso'), { target: { value: 'Solicitação conferida' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Confirmar desativação' }).closest('form')!);
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith('/admin/accounts/student/status', { active: false, version: 4, reason: 'Solicitação conferida', activeEnrollmentCount: 2 });
});
it('A16: inativa oferece reativação, não convite/recuperação; owner não oferece desativação', async () => {
  const inactive = { ...account, active: false, accepted: false };
  const { rerender } = render(<AccountPanel actor={owner} accounts={[inactive]} refresh={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Selecionar conta'), { target: { value: account.id } });
  expect(screen.getByText('Reativar acesso da conta')).toBeInTheDocument();
  expect(screen.queryByText('Gerar link de convite')).not.toBeInTheDocument();
  expect(screen.getByText(/não restaura sessões/)).toBeInTheDocument();
  rerender(<AccountPanel actor={owner} accounts={[{ ...account, roles: ['OWNER'] }]} refresh={vi.fn()} />);
  expect(screen.queryByText('Desativar acesso da conta')).not.toBeInTheDocument();
});
it('A05: admin não gerencia estado de outro admin', async () => {
  render(<AccountPanel actor={{ ...owner, roles: ['ADMIN'] }} accounts={[{ ...account, roles: ['ADMIN', 'PROFESSOR'] }]} refresh={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Selecionar conta'), { target: { value: account.id } });
  expect(screen.queryByText('Desativar acesso da conta')).not.toBeInTheDocument();
});
it('R19: conflito de acesso não anuncia sucesso e exige revisão consciente', async () => {
  const refresh = vi.fn();
  vi.mocked(api).mockImplementation(async path => { if (path.endsWith('/status')) throw new ApiError(409, 'As matrículas mudaram.', [], 'VERSION_CONFLICT'); return { enabled: false }; });
  render(<AccountPanel actor={owner} accounts={[account]} refresh={refresh} />);
  fireEvent.change(screen.getByLabelText('Selecionar conta'), { target: { value: account.id } });
  fireEvent.submit(screen.getByText('Confirmar desativação').closest('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('As matrículas mudaram.');
  expect(screen.queryByText('Alteração salva.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Atualizar dados para revisão'));
  expect(refresh).toHaveBeenCalledOnce();
});
it('A29/A30: turma arquivada preserva lista e só oferece reativação à administração', async () => {
  useUiStore.getState().selectOffering(offering.id);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const props = { offerings: [{ ...offering, active: false }], accounts: [], catalog: { disciplines: [], locations: [] }, timeZone: 'America/Sao_Paulo', refresh };
  const { rerender } = render(<OfferingPanel {...props} admin />);
  expect(screen.getByText('Lista de aulas preservada')).toBeInTheDocument();
  expect(screen.queryByText('Matricular aluno')).not.toBeInTheDocument();
  expect(screen.queryByText('Salvar professores')).not.toBeInTheDocument();
  expect(screen.queryByText('Criar aula')).not.toBeInTheDocument();
  expect(screen.queryByText('Programar aulas')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Reativar turma'));
  fireEvent.submit(screen.getByText('Confirmar reativação').closest('form')!);
  await waitFor(() => expect(api).toHaveBeenCalledWith('/offerings/offering/status', { active: true, version: 2, reason: '' }));
  rerender(<OfferingPanel {...props} admin={false} />);
  expect(screen.queryByText('Reativar turma')).not.toBeInTheDocument();
});
