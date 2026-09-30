import { afterEach, expect, test } from 'vitest';
import { useUiStore } from './ui-store';

afterEach(() => useUiStore.getState().reset());

test('Interface: seleção de turma e seção são independentes', () => {
  useUiStore.getState().selectOffering('offering-test');
  useUiStore.getState().selectSection('accounts');
  expect(useUiStore.getState()).toMatchObject({ offeringId: 'offering-test', section: 'accounts' });
});

test('Interface: visibilidade da senha alterna sem armazenar a senha', () => {
  useUiStore.getState().togglePassword();
  expect(useUiStore.getState().showPassword).toBe(true);
  useUiStore.getState().togglePassword();
  expect(useUiStore.getState().showPassword).toBe(false);
  expect(useUiStore.getState()).not.toHaveProperty('password');
});

test('Interface: reset remove seleção e visibilidade entre contas', () => {
  useUiStore.getState().selectOffering('previous-account-offering');
  useUiStore.getState().selectSection('accounts');
  useUiStore.getState().togglePassword();
  useUiStore.getState().reset();
  expect(useUiStore.getState()).toMatchObject({ offeringId: '', section: 'offerings', showPassword: false });
});
