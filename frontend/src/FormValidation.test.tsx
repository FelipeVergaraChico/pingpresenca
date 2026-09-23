// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { api, ApiError } from './api';
import { ActionForm, Field } from './academic/Form';
import { FormLabel, ValidationGroup } from './FormValidation';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('E1/A83: API errors reach fields, preserve values and focus repeats; retry clears feedback', async () => {
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      ++calls < 3
        ? new Response(
            JSON.stringify({
              code: 'VALIDATION_ERROR',
              message: 'Corrija os campos indicados e tente novamente.',
              fieldErrors: [
                { field: 'name', message: 'Nome: informe pelo menos 2 caracteres.' },
                { field: 'disciplineId', message: 'Disciplina: selecione uma opção válida.' },
                { field: 'description', message: 'Descrição: use no máximo 2000 caracteres.' },
              ],
            }),
            { status: 400 },
          )
        : new Response(JSON.stringify({ updated: true })),
    ),
  );
  render(
    <ActionForm
      onConflict={vi.fn()}
      onSave={async () => {
        await api('/disciplines', {});
      }}
    >
      <Field label="Nome" name="name" initial="X" />
      <FormLabel>
        Disciplina
        <select name="disciplineId">
          <option value="old">Disciplina antiga</option>
        </select>
      </FormLabel>
      <FormLabel>
        Descrição
        <textarea name="description" aria-describedby="hint" defaultValue="Texto preservado" />
      </FormLabel>
      <p id="hint">Uma descrição útil.</p>
    </ActionForm>,
  );
  const save = screen.getByRole('button', { name: 'Salvar' }),
    form = save.closest('form')!;
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.getByLabelText('Nome', { exact: true })).toHaveValue('X');
  expect(screen.getByLabelText('Nome', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Nome', { exact: true })).toHaveAccessibleDescription(
    'Nome: informe pelo menos 2 caracteres.',
  );
  expect(screen.getByLabelText('Descrição', { exact: true })).toHaveAccessibleDescription(
    'Uma descrição útil. Descrição: use no máximo 2000 caracteres.',
  );
  expect(screen.getByLabelText('Descrição', { exact: true })).toHaveValue('Texto preservado');
  expect(
    screen.queryByRole('button', { name: 'Atualizar dados para revisão' }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /Disciplina:/ }));
  expect(screen.getByRole('combobox')).toHaveFocus();
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  fireEvent.submit(form);
  expect(await screen.findByRole('status')).toHaveTextContent('Alteração salva.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Nome', { exact: true })).not.toHaveAttribute('aria-invalid');
  expect(screen.getByLabelText('Descrição', { exact: true })).toHaveAttribute(
    'aria-describedby',
    'hint',
  );
});

test('E1/A83: missing roles are described once per group and can be focused from summary', async () => {
  render(
    <ActionForm
      onSave={async () => {
        throw new ApiError(400, 'Corrija os campos.', [
          { field: 'roles', message: 'Papéis: selecione pelo menos uma opção.' },
        ]);
      }}
    >
      <ValidationGroup name="roles" legend="Papéis">
        <FormLabel>
          <input name="roles" type="checkbox" value="STUDENT" />
          Aluno
        </FormLabel>
        <FormLabel>
          <input name="roles" type="checkbox" value="PROFESSOR" />
          Professor
        </FormLabel>
      </ValidationGroup>
    </ActionForm>,
  );
  fireEvent.submit(screen.getByRole('button', { name: 'Salvar' }).closest('form')!);
  await screen.findByRole('alert');
  expect(screen.getByRole('group', { name: 'Papéis' })).toHaveAccessibleDescription(
    'Papéis: selecione pelo menos uma opção.',
  );
  expect(screen.getByRole('checkbox', { name: 'Aluno' })).toHaveAttribute('aria-invalid', 'true');
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /Papéis:/ }));
  expect(screen.getByRole('checkbox', { name: 'Aluno' })).toHaveFocus();
});

test('E1: generic failures remain usable without invented field errors or conflict actions', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('Unavailable', { status: 503 })),
  );
  render(
    <ActionForm
      onConflict={vi.fn()}
      onSave={async () => {
        await api('/disciplines', {});
      }}
    >
      <Field label="Nome" name="name" initial="Nome válido" />
    </ActionForm>,
  );
  fireEvent.submit(screen.getByRole('button', { name: 'Salvar' }).closest('form')!);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.getByLabelText('Nome')).not.toHaveAttribute('aria-invalid');
  expect(
    screen.queryByRole('button', { name: 'Atualizar dados para revisão' }),
  ).not.toBeInTheDocument();
});
