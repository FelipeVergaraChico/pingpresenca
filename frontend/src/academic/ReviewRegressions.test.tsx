// @vitest-environment jsdom
// Permanent regressions from REV-01 through REV-05 (E0/E1 review).
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { OfferingPanel } from './OfferingPanel';
import { CatalogPanel } from './CatalogPanel';
import { Invitation } from '../Invitation';
import { useUiStore } from '../ui-store';
import type { Offering } from './types';
import { ActionForm } from './Form';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useUiStore.getState().reset(); });
const json = (body: unknown) => new Response(JSON.stringify(body));
const a: Offering = {id:'a', name:'Turma A', discipline_id:'d', discipline_name:'Disciplina',
  term:'2026/1', shift:'Manhã', active:true, attendance_mode:'PILOT', version:1, can_manage:true};
const b: Offering = {...a, id:'b', name:'Turma B',term:'2026/2',shift:'Noite',attendance_mode:'OFFICIAL'};
const catalog = {disciplines:[], locations:[]};
function panel(offerings = [a,b], refresh = vi.fn(async () => {})) {
  return <OfferingPanel admin offerings={offerings} accounts={[]} catalog={catalog} timeZone="America/Sao_Paulo" refresh={refresh}/>;
}
function mockEmpty() { vi.stubGlobal('fetch',vi.fn(async (url: string) => json(url.endsWith('/members') ? {teachers:[],enrollments:[]} : []))); }
async function selectA() { useUiStore.getState().selectOffering('a'); render(panel()); await waitFor(() => expect(screen.getByRole('heading',{name:'Turma A'})).toBeInTheDocument()); }

test('R01: switching same-version offerings must refresh editable values before saving', async () => {
  mockEmpty(); await selectA();
  fireEvent.click(screen.getByText('Editar dados da turma'));
  expect(screen.getByLabelText('Nome da turma')).toHaveValue('Turma A');
  fireEvent.change(screen.getByLabelText('Selecionar turma'),{target:{value:'b'}});
  await screen.findByRole('heading',{name:'Turma B'});
  const form=screen.getByLabelText('Nome da turma').closest('form')!;
  fireEvent.submit(form);
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, options]) => url === '/api/offerings/b' && options?.method === 'POST')).toBe(true));
  const saved=vi.mocked(fetch).mock.calls.find(([url,options])=>url === '/api/offerings/b' && options?.method === 'POST');
  expect(JSON.parse(String(saved?.[1]?.body)).name).toBe('Turma B');
  expect(screen.getByLabelText('Nome da turma')).toHaveValue('Turma B');
});

test('R02: changing offering default must update a fresh lesson form, not preserve old default', async () => {
  mockEmpty(); useUiStore.getState().selectOffering('a'); const view=render(panel([a]));
  const lessonForm=screen.getByRole('button',{name:'Criar aula'}).closest('form')!;
  expect(lessonForm.querySelector('[name="attendanceMode"]')).toHaveValue('PILOT');
  view.rerender(panel([{...a,version:2,attendance_mode:'OFFICIAL'}]));
  await waitFor(() => expect(screen.getByText('Ativa · Oficial')).toBeInTheDocument());
  expect(lessonForm.querySelector('[name="attendanceMode"]')).toHaveValue('OFFICIAL');
});

test('R03: a late eligibility response must not appear under another offering', async () => {
  let resolvePreview!: (r:Response)=>void;
  const pending = new Promise<Response>(resolve => { resolvePreview=resolve; });
  const lesson={id:'lesson-a',offering_id:'a',location_id:'l',location_name:'Sala A',title:'Aula A',description:'',starts_at:'2026-09-10T22:00:00Z',ends_at:'2026-09-11T00:00:00Z',attendance_mode:'PILOT',version:1,context_locked_at:null,mode_locked_at:null};
  vi.stubGlobal('fetch',vi.fn(async (url:string) => url.endsWith('/planning') ? pending
    : json(url.endsWith('/members') ? {teachers:[],enrollments:[]} : url.includes('/a/') ? [lesson] : [])));
  await selectA();
  fireEvent.click(await screen.findByRole('button',{name:'Elegibilidade de Aula A'}));
  fireEvent.change(screen.getByLabelText('Selecionar turma'),{target:{value:'b'}});
  await screen.findByRole('heading',{name:'Turma B'});
  await act(async () => {resolvePreview(json({students:[{account_id:'sa',name:'Aluno exclusivo A'}],policyPreview:{name:'Sala A',radius:100,geoRequired:true}}));});
  expect(screen.queryByText('Aluno exclusivo A')).not.toBeInTheDocument();
});

test('R04: changing invitation token must hide old identity and disable acceptance until inspection', async () => {
  const newInfo = new Promise<Response>(() => {});
  const fetch=vi.fn(async (url:string, options:RequestInit) => url.endsWith('/accept') ? json({accepted:true}) :
    JSON.parse(String(options.body)).token === 'a'.repeat(43) ? json({name:'Pessoa A',email:'a@example.com',channel:'MANUAL'}) : newInfo);
  vi.stubGlobal('fetch',fetch);
  const view=render(<Invitation token={'a'.repeat(43)}/>);
  await screen.findByText('a@example.com');
  view.rerender(<Invitation token={'b'.repeat(43)}/>);
  const oldIdentity=screen.queryByText('a@example.com');
  const accept=screen.queryByRole('button',{name:'Aceitar convite e definir senha'});
  if(accept) {
    fireEvent.change(screen.getByLabelText('Nova senha',{exact:true}),{target:{value:'synthetic-password-long'}});
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'),{target:{value:'synthetic-password-long'}});
    fireEvent.submit(accept.closest('form')!);
    await waitFor(()=>expect(fetch.mock.calls.some(([url])=>url.endsWith('/accept'))).toBe(true));
  }
  // No acceptance may be sent while the displayed identity belongs to another token.
  expect(fetch.mock.calls.filter(([url])=>url.endsWith('/accept'))).toHaveLength(0);
  expect(oldIdentity).toBeNull();
});

test('R05: a persisted creation followed by refresh failure must not invite duplicate submission', async () => {
  const fetch=vi.fn(async () => json({id:'persisted-discipline'})); vi.stubGlobal('fetch',fetch);
  const refresh=vi.fn(async (): Promise<void> => {throw new Error('Falha ao recarregar a lista.');});
  render(<CatalogPanel catalog={catalog} refresh={refresh}/>);
  fireEvent.change(screen.getByLabelText('Nome da disciplina'),{target:{value:'Disciplina única'}});
  const form=screen.getByRole('button',{name:'Criar disciplina'}).closest('form')!;
  fireEvent.submit(form); await screen.findByRole('alert');
  expect(fetch).toHaveBeenCalledTimes(1);
  // Persistence succeeded: feedback must say so instead of reporting only a failure.
  expect(screen.getByRole('alert')).toHaveTextContent(/salv|criad|cadastrad/i);
  expect(screen.getByRole('button', { name: 'Criar disciplina' })).toBeDisabled();
  fireEvent.submit(form);
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar lista' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  expect(fetch).toHaveBeenCalledTimes(1);
  refresh.mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar lista' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Criar disciplina' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Nome da disciplina'), { target: { value: 'Outra disciplina' } });
  expect(screen.getByRole('button', { name: 'Criar disciplina' })).toBeEnabled();
});

test('R02: changing a default preserves an explicitly selected mode and other draft fields', async () => {
  mockEmpty(); useUiStore.getState().selectOffering('a'); const view=render(panel([a]));
  const form=screen.getByRole('button',{name:'Criar aula'}).closest('form')!;
  fireEvent.change(screen.getByLabelText('Título da aula'), {target:{value:'Rascunho preservado'}});
  fireEvent.change(form.querySelector('[name="attendanceMode"]')!, {target:{value:'OFFICIAL'}});
  fireEvent.change(form.querySelector('[name="attendanceMode"]')!, {target:{value:'PILOT'}});
  view.rerender(panel([{...a, version:2, attendance_mode:'OFFICIAL'}]));
  expect(form.querySelector('[name="attendanceMode"]')).toHaveValue('PILOT');
  expect(screen.getByLabelText('Título da aula')).toHaveValue('Rascunho preservado');
});

test('R04: a failed or completed invitation must not contaminate another token', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url:string, options:RequestInit) => {
    const body=JSON.parse(String(options.body));
    return body.token === 'invalid' ? new Response(JSON.stringify({message:'Convite inválido.'}), {status:400})
      : json({name:body.token,email:`${body.token}@example.com`,channel:'MANUAL'});
  }));
  const view=render(<Invitation token="invalid"/>);
  await screen.findByRole('alert');
  view.rerender(<Invitation token="valid-a"/>);
  await screen.findByText('valid-a@example.com');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Nova senha',{exact:true}), {target:{value:'synthetic-password-long'}});
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), {target:{value:'synthetic-password-long'}});
  fireEvent.submit(screen.getByRole('button',{name:'Aceitar convite e definir senha'}).closest('form')!);
  await screen.findByRole('heading', {name:'Cadastro concluído.'});
  view.rerender(<Invitation token="valid-b"/>);
  await screen.findByText('valid-b@example.com');
  expect(screen.queryByRole('heading', {name:'Cadastro concluído.'})).not.toBeInTheDocument();
  expect(screen.getByLabelText('Nova senha',{exact:true})).toHaveValue('');
});

test('R04: an acceptance finishing after a token switch must not replace the new URL', async () => {
  let finish!: (r:Response)=>void;
  const pending = new Promise<Response>(resolve => { finish=resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url:string, options:RequestInit) => url.endsWith('/accept') ? pending
    : json({name:'Pessoa', email:`${JSON.parse(String(options.body)).token}@example.com`,channel:'MANUAL'})));
  const view=render(<Invitation token="a"/>);
  await screen.findByText('a@example.com');
  fireEvent.change(screen.getByLabelText('Nova senha',{exact:true}), {target:{value:'synthetic-password-long'}});
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), {target:{value:'synthetic-password-long'}});
  fireEvent.submit(screen.getByRole('button',{name:'Aceitar convite e definir senha'}).closest('form')!);
  history.replaceState(null,'','/#invite=b');
  view.rerender(<Invitation token="b"/>);
  await screen.findByText('b@example.com');
  await act(async () => { finish(json({accepted:true})); });
  expect(location.hash).toBe('#invite=b');
  expect(screen.getByText('b@example.com')).toBeInTheDocument();
  history.replaceState(null,'','/');
});

test('R07: enrollment end controls use the backend capability, not a local clock', async () => {
  vi.stubGlobal('fetch',vi.fn(async (url:string) => json(url.endsWith('/members') ? {teachers:[],enrollments:[
    {id:'e1',account_id:'s1',name:'Agendada',enrolled_at:'2026-01-01T00:00:00Z',ended_at:'2099-01-01T00:00:00Z',can_end:true,version:1},
    {id:'e2',account_id:'s2',name:'Encerrada',enrolled_at:'2025-01-01T00:00:00Z',ended_at:'2025-02-01T00:00:00Z',can_end:false,version:1},
  ]} : [])));
  await selectA();
  await screen.findByText('Encerrar matrícula de Agendada');
  expect(screen.queryByText('Encerrar matrícula de Encerrada')).not.toBeInTheDocument();
});

test('R03: the latest preview wins within the same offering, including late errors', async () => {
  const pending: { resolve: (r:Response)=>void; reject: (e:Error)=>void }[] = [];
  const lesson={id:'l1',offering_id:'a',location_id:'loc',location_name:'Sala',title:'Aula',description:'',starts_at:'2026-09-10T22:00:00Z',ends_at:'2026-09-11T00:00:00Z',attendance_mode:'PILOT',version:1,context_locked_at:null,mode_locked_at:null};
  vi.stubGlobal('fetch',vi.fn(async (url:string) => url.endsWith('/planning')
    ? new Promise<Response>((resolve,reject) => pending.push({resolve,reject}))
    : json(url.endsWith('/members') ? {teachers:[],enrollments:[]} : [lesson])));
  await selectA();
  const button=await screen.findByRole('button',{name:'Elegibilidade de Aula'});
  fireEvent.click(button); fireEvent.click(button);
  await act(async () => pending[1]!.resolve(json({students:[{account_id:'s',name:'Resultado atual'}],policyPreview:{name:'Sala',radius:100,geoRequired:true}})));
  await screen.findByText('Resultado atual');
  await act(async () => pending[0]!.reject(new Error('Erro de solicitação antiga')));
  expect(screen.getByText('Resultado atual')).toBeInTheDocument();
  expect(screen.queryByText('Erro de solicitação antiga')).not.toBeInTheDocument();
});

test('R05: actions without a refresh remain repeatable after completion, never concurrently', async () => {
  let finish!: ()=>void;
  const save=vi.fn(() => new Promise<void>(resolve => {finish=resolve;}));
  render(<ActionForm onSave={save} submit="Gerar link"><p>Link de uso único</p></ActionForm>);
  const button=screen.getByRole('button',{name:'Gerar link'});
  fireEvent.submit(button.closest('form')!);
  fireEvent.submit(button.closest('form')!);
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(button).toBeEnabled();
  fireEvent.submit(button.closest('form')!);
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => finish());
});
