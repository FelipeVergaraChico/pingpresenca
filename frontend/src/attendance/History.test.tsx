// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { History } from './History';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
test('Styled history preserves modes, provisional totals and cancelled/pending records', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    pagination: { page: 1, pages: 1, pageSize: 10, total: 3 },
    frequency: [
      { mode: 'PILOT', present: 3, absent: 1, pending: 1, provisional: true, percent: 75 },
      { mode: 'OFFICIAL', present: 0, absent: 0, pending: 0, provisional: false, percent: null },
    ],
    lessons: [
      { id: 'one', title: 'Aula confirmada', starts_at: '2026-09-29T12:00:00Z', attendance_mode: 'PILOT', status: 'PRESENT', source: 'MANUAL', reason: 'Registro definido manualmente.', included: true },
      { id: 'two', title: 'Aula cancelada', starts_at: '2026-09-29T12:00:00Z', attendance_mode: 'OFFICIAL', status: 'ABSENT', source: 'AUTO_CLOSE', included: false, cancelled: true },
      { id: 'three', title: 'Aula pendente', starts_at: '2026-09-29T12:00:00Z', attendance_mode: 'PILOT', status: 'PENDING', source: 'AUTOMATIC', included: true, reopened: true, reason: 'Localização não pôde ser validada.' },
    ],
  }))));
  render(<History offeringId="class" timeZone="America/Sao_Paulo" />);
  expect(await screen.findByText('75.0%')).toBeVisible();
  expect(screen.getByText('Provisória')).toBeVisible();
  expect(screen.getByText('Frequência ainda não calculada')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Aula confirmada' })).toHaveAttribute('href', '/#attendance=one');
  expect(screen.getByText('Presença manual')).toBeVisible();
  expect(screen.getByText('Aula cancelada — fora do cálculo')).toBeVisible();
  expect(screen.getByText('Chamada reaberta — frequência provisória')).toBeVisible();
  expect(screen.getByText('Localização não pôde ser validada.')).toBeVisible();
});
test('History has explicit loading and empty states without inventing a percentage', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ frequency: [], lessons: [], pagination: { page: 1, pages: 1, pageSize: 10, total: 0 } }))));
  render(<History offeringId="empty" timeZone="America/Sao_Paulo" />);
  expect(screen.getByRole('status')).toHaveTextContent('Carregando sua frequência');
  expect(await screen.findByText('Nenhuma aula disponível no seu histórico desta turma.')).toBeVisible();
  expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
});
