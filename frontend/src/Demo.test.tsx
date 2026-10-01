// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DemoBanner, DemoLanding } from './Demo';
import type { Installation } from './api';
import { App } from './App';

const installation: Installation = { name: 'Demo', timeZone: 'America/Sao_Paulo',
  initialized: true, bootstrapAvailable: false, serverTime: '2026-09-30T12:00:00Z',
  demo: { expiresAt: '2026-10-01T12:00:00Z', expired: false, remainingOperations: 5000 } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.location.hash = ''; });

test('DEMO-07: entrada identifica dados compartilhados e não pede informações pessoais', () => {
  render(<DemoLanding installation={installation} onEnter={vi.fn()} scanning={false} />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dois pontos de vista');
  expect(screen.getByLabelText('Aviso de demonstração pública')).toHaveTextContent('Não insira informações reais');
  expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(4);
});
test('DEMO-02/07: clique envia só perfil definido e recebe conta do backend', async () => {
  const account = { id: 'demo', name: 'Aluno 1', email: 'aluno-1@demo.invalid', roles: ['STUDENT'] };
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/auth/me') ? account : { authenticated: true })));
  vi.stubGlobal('fetch', fetch);
  const enter = vi.fn();
  render(<DemoLanding installation={installation} onEnter={enter} scanning />);
  expect(screen.getByText(/Você abriu uma chamada por link ou QR/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Entrar como aluno 1' }));
  await waitFor(() => expect(enter).toHaveBeenCalledWith(account));
  expect(fetch).toHaveBeenCalledWith('/api/demo/login', expect.objectContaining({ body: '{"profile":"aluno-1"}' }));
});
test('DEMO-05/07: ciclo vencido desabilita entrada sem confiar apenas no relógio local', () => {
  render(<DemoLanding installation={{ ...installation, demo: { ...installation.demo!, expired: true } }}
    onEnter={vi.fn()} scanning={false} />);
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('aguarda restauração');
});
test('DEMO-07: falha de entrada é explicada sem simular login', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Limite de acessos atingido.' }), { status: 429 })));
  const enter = vi.fn();
  render(<DemoLanding installation={installation} onEnter={enter} scanning={false} />);
  fireEvent.click(screen.getByRole('button', { name: /Experimentar como professor/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Limite de acessos atingido.');
  expect(enter).not.toHaveBeenCalled();
});
test('DEMO-07: aviso não aparece em instalação regular', () => {
  render(<DemoBanner installation={{ ...installation, demo: undefined }} />);
  expect(screen.queryByLabelText('Aviso de demonstração pública')).not.toBeInTheDocument();
});
test('DEMO-07: App apresenta landing em lugar de bootstrap e preserva link QR', async () => {
  window.location.hash = '#attendance=synthetic-lesson&challenge=synthetic-challenge';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/auth/me')
    ? new Response('{}', { status: 401 }) : new Response(JSON.stringify(installation))));
  render(<App />);
  expect(await screen.findByRole('heading', { level: 1, name: /Dois pontos de vista/ })).toBeVisible();
  expect(screen.queryByLabelText('Segredo de configuração')).not.toBeInTheDocument();
  expect(window.location.hash).toContain('challenge=synthetic-challenge');
});
