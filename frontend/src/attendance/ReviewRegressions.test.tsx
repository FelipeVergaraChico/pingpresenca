// Permanent regressions from the E2 review.
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AttendancePage } from './AttendancePage';
import { ApiError } from '../api';
import type { View } from './types';

const mocks = vi.hoisted(() => ({ api: vi.fn(), reload: vi.fn(), view: {} as View }));
vi.mock('../api', async (original) => ({
  ...await original<object>(), api: mocks.api,
}));
vi.mock('./useLive', () => ({
  useLive: () => ({ data: mocks.view, error: '', reload: mocks.reload }),
  useRemaining: () => 60,
}));
const account = { id: 'ana', name: 'Ana', email: 'ana@example.test', roles: ['ADMIN', 'STUDENT'] };
function page() {
  return render(<AttendancePage lessonId="lesson" account={account} timeZone="America/Sao_Paulo" />);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.reload.mockResolvedValue(undefined);
  mocks.view = {
    lesson: { id: 'lesson', title: 'Aula', offeringId: 'offering', offering: 'Turma', discipline: 'Disciplina',
      startsAt: '2026-09-23T12:00:00Z', endsAt: '2026-09-23T14:00:00Z', mode: 'PILOT' },
    manages: true, administrative: true, serverNow: '2026-09-23T12:30:00Z',
    state: 'OPEN', expiresAt: '2026-09-23T12:40:00Z', defaultMinutes: 10,
    records: ['Ana', 'Bia'].map((name) => ({ account_id: name.toLowerCase(), name,
      status: 'PENDING', source: 'AUTOMATIC', reason: 'GEO_UNAVAILABLE', version: 1, manual: false })),
    attempts: [], audit: [],
  };
});
afterEach(cleanup);

test('Control: student-only view exposes automatic confirmation', () => {
  mocks.view.manages = false;
  mocks.view.administrative = false;
  page();
  expect(screen.queryByRole('button', { name: 'Validar código' })).not.toBeNull();
});

test('Control: pending review offers an explicit absence decision', () => {
  page();
  fireEvent.click(screen.getByRole('button', { name: 'Analisar Ana' }));
  expect(screen.queryByRole('option', { name: 'Ausência' })).not.toBeNull();
});

test('R01/R11: enrolled ADMIN+STUDENT can access their automatic attendance flow', () => {
  page();
  expect(screen.queryByRole('button', { name: 'Validar código' })).not.toBeNull();
});

test('R14: teacher can make an explicit absence decision over an automatic absence', () => {
  mocks.view.state = 'CLOSED';
  mocks.view.records[0] = { ...mocks.view.records[0]!, status: 'ABSENT', source: 'AUTO_CLOSE' };
  page();
  fireEvent.click(screen.getByRole('button', { name: 'Analisar Ana' }));
  expect(screen.queryByRole('option', { name: 'Ausência' })).not.toBeNull();
});

test('R14/A51: explicit absence sends CORRECTION, not a manual presence', async () => {
  mocks.api.mockResolvedValue({ updated: true });
  mocks.view.state = 'CLOSED';
  mocks.view.records[0] = { ...mocks.view.records[0]!, status: 'ABSENT', source: 'AUTO_CLOSE' };
  page();
  fireEvent.click(screen.getByRole('button', { name: 'Analisar Ana' }));
  fireEvent.change(screen.getByLabelText('Resultado da decisão'), { target: { value: 'ABSENT' } });
  fireEvent.change(screen.getByLabelText('Justificativa da decisão'), { target: { value: 'Ausência verificada' } });
  await act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: 'Aplicar decisão justificada' }).closest('form')!);
  });
  expect(mocks.api).toHaveBeenCalledWith('/attendance/lesson/decision', {
    accountId: 'ana', version: 1, kind: 'CORRECTION', status: 'ABSENT', reason: 'Ausência verificada',
  });
});

test('R01/R11: manager without eligible enrollment has no student form', () => {
  mocks.view.records = mocks.view.records.filter((r) => r.account_id !== account.id);
  page();
  expect(screen.queryByRole('button', { name: 'Validar código' })).toBeNull();
});

test('R19/A52: stale conflict refresh cannot replace a different selected student', async () => {
  let resolve!: (view: View) => void;
  mocks.api.mockRejectedValueOnce(new ApiError(409, 'Registro alterado', [], 'VERSION_CONFLICT'));
  mocks.api.mockImplementationOnce(() => new Promise<View>((done) => { resolve = done; }));
  page();
  fireEvent.click(screen.getByRole('button', { name: 'Analisar Ana' }));
  await act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: 'Aplicar decisão justificada' }).closest('form')!);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar dados para revisão' }));
  fireEvent.click(screen.getByRole('button', { name: 'Analisar Bia' }));
  await act(async () => { resolve(mocks.view); });
  expect(screen.queryByRole('region', { name: 'Análise de Bia' })).not.toBeNull();
});

test('R19: completing a previous analysis does not discard the newly selected student draft', async () => {
  let resolve!: () => void;
  mocks.api.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
  page();
  fireEvent.click(screen.getByRole('button', { name: 'Analisar Ana' }));
  fireEvent.change(screen.getByLabelText('Justificativa da decisão'), { target: { value: 'Confirmado em sala' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Aplicar decisão justificada' }).closest('form')!);
  expect(mocks.api).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Analisar Bia' }));
  fireEvent.change(screen.getByLabelText('Justificativa da decisão'), { target: { value: 'Análise de Bia em andamento' } });
  await act(async () => { resolve(); });
  expect(screen.queryByRole('region', { name: 'Análise de Bia' })).not.toBeNull();
  expect((screen.getByLabelText('Justificativa da decisão') as HTMLInputElement).value)
    .toBe('Análise de Bia em andamento');
});
