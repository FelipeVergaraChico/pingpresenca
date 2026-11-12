// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccountImportPanel } from './AccountImportPanel';
import { api } from '../api';
import type { Offering } from './types';
import { importTemplate } from './import-input';
vi.mock('../api', () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const preview = { previewHash: 'hash', valid: true, rows: [{ record: 1, name: 'Ana', email: 'ana@example.com', institutionalId: null, role: 'STUDENT', errors: [] }] };
it('carrega arquivo sem chamar API e invalida a prévia anterior', async () => {
  vi.mocked(api).mockResolvedValue(preview);
  render(<AccountImportPanel refresh={vi.fn()} />);
  fireEvent.click(screen.getByText('Visualizar prévia da importação'));
  await screen.findByText('Confirmar criação das contas');
  fireEvent.change(screen.getByLabelText('Selecionar arquivo CSV'), { target: { files: [new File([importTemplate], 'contas.csv', { type: 'text/csv' })] } });
  await screen.findByText(/Arquivo contas.csv carregado/);
  expect((screen.getByLabelText('Dados CSV') as HTMLTextAreaElement).value).toBe(importTemplate);
  expect(screen.queryByText('Confirmar criação das contas')).toBeNull();
  expect(api).toHaveBeenCalledTimes(1);
});
it.each([
  [new File(['x'], 'contas.xlsx'), /Selecione um arquivo .csv/],
  [new File(['a'.repeat(65537)], 'contas.csv'), /excede 64 KiB/],
])('recusa arquivo inadequado sem enviar dados', async (file, message) => {
  render(<AccountImportPanel refresh={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Selecionar arquivo CSV'), { target: { files: [file] } });
  await screen.findByText(message);
  expect(api).not.toHaveBeenCalled();
});
it('normaliza colagem de planilha antes de enviar prévia e confirmação', async () => {
  vi.mocked(api).mockResolvedValueOnce(preview).mockResolvedValueOnce({ created: 1, batchId: 'batch' });
  render(<AccountImportPanel refresh={vi.fn(async () => {})} />);
  fireEvent.change(screen.getByLabelText('Dados CSV'), { target: { value: 'nome\temail\tidentificador\tpapel\nAna\tana@example.com\t\tALUNO' } });
  fireEvent.click(screen.getByText('Visualizar prévia da importação'));
  fireEvent.click(await screen.findByText('Confirmar criação das contas'));
  await screen.findByText('Gerar convites do lote');
  const expected = { csv: 'nome,email,identificador,papel\n"Ana","ana@example.com","","ALUNO"' };
  expect(vi.mocked(api).mock.calls[0]?.[1]).toMatchObject(expected);
  expect(vi.mocked(api).mock.calls[1]?.[1]).toMatchObject(expected);
});
it('prévia não cria contas; editar invalida a confirmação', async () => {
  vi.mocked(api).mockResolvedValue(preview);
  render(<AccountImportPanel refresh={vi.fn()} />);
  fireEvent.click(screen.getByText('Visualizar prévia da importação'));
  await screen.findByText('Confirmar criação das contas');
  expect(api).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Dados CSV'), { target: { value: 'alterado' } });
  expect(screen.queryByText('Confirmar criação das contas')).toBeNull();
});
it('falha de atualização após sucesso não permite repetir criação', async () => {
  vi.mocked(api).mockResolvedValueOnce(preview).mockResolvedValueOnce({ created: 1 });
  render(<AccountImportPanel refresh={vi.fn().mockRejectedValue(new Error())} />);
  fireEvent.click(screen.getByText('Visualizar prévia da importação'));
  fireEvent.click(await screen.findByText('Confirmar criação das contas'));
  await screen.findByText('Atualizar lista de contas');
  expect(screen.queryByText('Confirmar criação das contas')).toBeNull();
  expect(api).toHaveBeenCalledTimes(2);
});
it('erros por registro bloqueiam confirmação e a prévia é paginada', async () => {
  vi.mocked(api).mockResolvedValue({ ...preview, valid: false, rows: Array.from({ length: 11 }, (_, i) => ({ ...preview.rows[0], record: i + 1, errors: ['E-mail já cadastrado.'] })) });
  render(<AccountImportPanel refresh={vi.fn()} />);
  fireEvent.click(screen.getByText('Visualizar prévia da importação'));
  await screen.findByText('Confirmar criação das contas');
  expect((screen.getByText('Confirmar criação das contas') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByRole('listitem')).toHaveLength(10);
  fireEvent.click(screen.getByText('Próxima'));
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
});
it('trocar a turma ou vigência invalida a prévia', async () => {
  vi.mocked(api).mockResolvedValue(preview);
  render(<AccountImportPanel refresh={vi.fn()} offerings={[{ id: 'turma', name: 'Turma', term: '2098', active: true } as Offering]} />);
  fireEvent.click(screen.getByText('Visualizar prévia da importação'));
  await screen.findByText('Confirmar criação das contas');
  fireEvent.change(screen.getByLabelText('Turma do lote (opcional)'), { target: { value: 'turma' } });
  expect(screen.queryByText('Confirmar criação das contas')).toBeNull();
  fireEvent.change(screen.getByLabelText('Início das matrículas'), { target: { value: '2098-01-01T00:00' } });
  fireEvent.click(screen.getByText('Visualizar prévia da importação'));
  await screen.findByText('Confirmar criação das contas');
  expect(vi.mocked(api).mock.lastCall?.[1]).toMatchObject({ offeringId: 'turma', enrolledLocal: '2098-01-01T00:00' });
});
it('convites exigem ação separada e substituição explícita', async () => {
  vi.mocked(api).mockResolvedValueOnce(preview).mockResolvedValueOnce({ created: 1, batchId: 'batch' }).mockResolvedValueOnce({ skipped: 0, links: [{ accountId: 'ana', name: 'Ana', email: 'ana@example.com', url: 'https://example.com/#invite=secret', expiresAt: '2098-01-01T00:00:00Z' }] });
  render(<AccountImportPanel refresh={vi.fn(async () => {})} />);
  fireEvent.click(screen.getByText('Visualizar prévia da importação'));
  fireEvent.click(await screen.findByText('Confirmar criação das contas'));
  const issue = await screen.findByText('Gerar convites do lote');
  expect(api).toHaveBeenCalledTimes(2);
  fireEvent.click(issue);
  await screen.findByDisplayValue('https://example.com/#invite=secret');
  expect((screen.getByText('Gerar convites do lote') as HTMLButtonElement).disabled).toBe(true);
  expect(vi.mocked(api).mock.lastCall?.[1]).toMatchObject({ replaceExisting: false });
  fireEvent.click(screen.getByRole('checkbox'));
  expect((screen.getByText('Substituir convites do lote') as HTMLButtonElement).disabled).toBe(false);
});
