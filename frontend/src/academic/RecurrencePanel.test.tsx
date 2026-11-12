// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecurrencePanel } from './RecurrencePanel';
import { api } from '../api';
vi.mock('../api', async load => ({ ...await load<object>(), api: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const preview = { timeZone: 'America/Sao_Paulo', previewHash: 'hash', createCount: 12,
  occurrences: Array.from({ length: 12 }, (_, i) => ({ startsAt: `2027-01-${String(i + 1).padStart(2, '0')}T22:00:00Z`, endsAt: `2027-01-${String(i + 1).padStart(2, '0')}T23:00:00Z`, action: 'CREATE' })) };
function setup(refresh = vi.fn(async () => {})) {
  render(<RecurrencePanel offeringId="offering" mode="PILOT" catalog={{ disciplines: [], locations: [] }} refresh={refresh} />);
  fireEvent.click(screen.getByText('Programar aulas recorrentes'));
  return screen.getByRole('button', { name: 'Visualizar prévia' }).closest('form')!;
}
it('A25: prévia não gera aulas e sua lista é paginada', async () => {
  vi.mocked(api).mockResolvedValue(preview);
  const form = setup(); fireEvent.submit(form);
  await screen.findByText(/12 nova/);
  expect(api).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api).mock.calls[0]![0]).toContain('/preview');
  expect(screen.getAllByRole('listitem')).toHaveLength(10);
  fireEvent.click(screen.getByText('Próxima'));
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
});
it('alterar o formulário invalida a prévia', async () => {
  vi.mocked(api).mockResolvedValue(preview);
  fireEvent.submit(setup()); await screen.findByText(/12 nova/);
  fireEvent.change(screen.getByLabelText('Título das aulas'), { target: { value: 'Outro título' } });
  expect(screen.queryByRole('button', { name: 'Confirmar geração das aulas' })).toBeNull();
});
it('confirma uma vez e falha na atualização da lista não repete escrita', async () => {
  vi.mocked(api).mockResolvedValueOnce(preview).mockResolvedValueOnce({ created: 12, kept: 0 });
  fireEvent.submit(setup(vi.fn(async () => { throw new Error('offline'); })));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmar geração das aulas' }));
  await waitFor(() => expect(screen.getByText(/Lote salvo/)).toBeTruthy());
  expect(api).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Confirmar geração das aulas' })).toBeNull();
});
