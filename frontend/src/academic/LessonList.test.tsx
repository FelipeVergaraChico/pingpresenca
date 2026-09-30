// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { LessonList } from './LessonList';
import { LessonTabs } from './ListControls';
import { History } from '../attendance/History';
import { useState } from 'react';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const json = (data: unknown) => new Response(JSON.stringify(data));
const row = (title: string) => ({id:title,title,starts_at:'2026-09-01T12:00:00Z',ends_at:'2026-09-01T13:00:00Z',attendance_mode:'PILOT',attendance_status:'NOT_OPENED',location_name:'Sala A'});
const props = {offeringId:'a',manages:true,scope:'upcoming',timeZone:'America/Sao_Paulo',revision:0,onEdit:vi.fn(),onPreview:vi.fn()};
test('LIST-02: pages and combined filters request the backend; filters reset page without hiding errors', async () => {
  const fetch = vi.fn(async (url: string) => {
    const q = new URL(url,'https://test.local').searchParams;
    if (q.get('from') === '2026-09-30') return new Response(JSON.stringify({message:'Data final: informe uma data igual ou posterior à inicial.'}),{status:400});
    return json({items:[row(`Aula página ${q.get('page')}`)],pagination:{page:Number(q.get('page')),pages:3,pageSize:10,total:25}});
  });
  vi.stubGlobal('fetch',fetch);
  render(<LessonList {...props}/>);
  await screen.findByRole('heading',{name:'Aula página 1'});
  expect(screen.getByRole('button',{name:'Anterior'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Próxima'}));
  await screen.findByRole('heading',{name:'Aula página 2'});
  expect(screen.getByRole('heading',{name:'Aulas encontradas'})).toHaveFocus();
  fireEvent.change(screen.getByLabelText('Modo'),{target:{value:'OFFICIAL'}});
  fireEvent.change(screen.getByLabelText('Situação da chamada'),{target:{value:'CLOSED'}});
  fireEvent.click(screen.getByRole('button',{name:'Aplicar filtros'}));
  await screen.findByRole('heading',{name:'Aula página 1'});
  expect(fetch.mock.lastCall?.[0]).toContain('page=1&pageSize=10&scope=upcoming&mode=OFFICIAL&status=CLOSED');
  fireEvent.change(screen.getByLabelText('De'),{target:{value:'2026-09-30'}});
  fireEvent.change(screen.getByLabelText('Até'),{target:{value:'2026-09-01'}});
  fireEvent.click(screen.getByRole('button',{name:'Aplicar filtros'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Data final');
  fireEvent.click(screen.getByRole('button',{name:'Limpar filtros'}));
  await screen.findByRole('heading',{name:'Aula página 1'});
  expect(screen.getByLabelText('Modo')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Modo'),{target:{value:'PILOT'}});
  fireEvent.click(screen.getByRole('button',{name:'Limpar filtros'}));
  expect(screen.getByLabelText('Modo')).toHaveValue('');
});
test('LIST-03: a slow old page must not replace the new selection', async () => {
  let finish!: (r:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(async (url:string) => url.includes('page=1&')
    ? new Promise<Response>(resolve=>{finish=resolve;})
    : json({items:[row('Atual')],pagination:{page:2,pages:2,pageSize:10,total:11}})));
  const view=render(<LessonList {...props}/>);
  await waitFor(()=>expect(fetch).toHaveBeenCalled());
  view.unmount();
  // Different offering mount must never receive the old request's result.
  vi.stubGlobal('fetch',vi.fn(async()=>json({items:[row('Nova turma')],pagination:{page:1,pages:1,pageSize:10,total:1}})));
  render(<LessonList {...props} offeringId="b"/>);
  await screen.findByRole('heading',{name:'Nova turma'});
  await act(async()=>finish(json({items:[row('Turma antiga')],pagination:{page:1,pages:1,pageSize:10,total:1}})));
  expect(screen.queryByText('Turma antiga')).not.toBeInTheDocument();
});
test('LIST-04/A82: keyboard arrows select tabs and move focus', () => {
  function Tabs() { const [value,setValue]=useState('upcoming'); return <LessonTabs value={value} onChange={setValue} tabs={[{value:'upcoming',label:'Próximas aulas'},{value:'past',label:'Histórico de aulas'}]}><p>{value}</p></LessonTabs>; }
  render(<Tabs/>);
  const first=screen.getByRole('tab',{name:'Próximas aulas'}), last=screen.getByRole('tab',{name:'Histórico de aulas'});
  first.focus(); fireEvent.keyDown(first,{key:'ArrowRight'});
  expect(last).toHaveFocus(); expect(last).toHaveAttribute('aria-selected','true');
  fireEvent.keyDown(last,{key:'Home'}); expect(first).toHaveFocus();
});
test('LIST-05/A63: changing history pages does not compute frequency from visible rows', async () => {
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>json({frequency:[{mode:'PILOT',present:3,absent:1,pending:0,provisional:false,percent:75}],
    lessons:[{...row(url.includes('page=2')?'Ausência antiga':'Presença recente'),status:url.includes('page=2')?'ABSENT':'PRESENT',included:true}],
    pagination:{page:url.includes('page=2')?2:1,pages:2,pageSize:10,total:11}})));
  render(<History offeringId="a" timeZone="America/Sao_Paulo"/>);
  await screen.findByText('75.0%');
  fireEvent.click(screen.getByRole('button',{name:'Próxima'}));
  await screen.findByRole('link',{name:'Ausência antiga'});
  expect(screen.getByText('75.0%')).toBeVisible();
});
