// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { LessonList } from './LessonList';
import { adjacentMonth, monthDays } from './LessonCalendar';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
test('CAL-02/A80: civil month geometry handles leap years and year boundaries without device timezone', () => {
  expect(monthDays('2028-02').days).toBe(29);
  expect(monthDays('2027-02').days).toBe(28);
  expect(monthDays('2026-03').offset).toBe(0);
  expect(adjacentMonth('2026-12',1)).toBe('2027-01');
  expect(adjacentMonth('2026-01',-1)).toBe('2025-12');
  expect(adjacentMonth('0099-12',1)).toBe('0100-01');
});
const lesson = {id:'one',title:'Aula compartilhada',description:'Descrição completa',starts_at:'2028-02-29T12:00:00Z',ends_at:'2028-02-29T14:00:00Z',location_name:'Sala A',attendance_mode:'OFFICIAL',attendance_status:'NOT_OPENED'};
const props={offeringId:'a',scope:'upcoming',revision:0,timeZone:'America/Sao_Paulo',manages:true,onEdit:vi.fn(),onPreview:vi.fn()};
test('CAL-03: optional calendar uses applied filters, server month and paginated shared details', async () => {
  const fetch=vi.fn(async(url:string)=> {
    const q=new URL(url,'https://test.local').searchParams;
    return new Response(JSON.stringify(q.get('view')==='calendar'
      ? {month:q.get('month') ?? '2028-02',days:q.get('month') === '2028-03' ? [] : [{date:'2028-02-29',total:12}]}
      : {items:[q.get('page')==='2' ? {...lesson,id:'two',title:'Outra página'} : lesson],pagination:{page:Number(q.get('page')),pages:2,pageSize:10,total:12}}));
  });
  vi.stubGlobal('fetch',fetch);
  render(<LessonList {...props}/>);
  await screen.findByRole('heading',{name:'Aula compartilhada'});
  fireEvent.change(screen.getByLabelText('Modo'),{target:{value:'OFFICIAL'}});
  fireEvent.click(screen.getByRole('button',{name:'Aplicar filtros'}));
  fireEvent.click(screen.getByRole('button',{name:'Calendário'}));
  await screen.findByRole('heading',{name:'fevereiro de 2028'});
  expect(fetch.mock.calls.some(([url])=>url.includes('mode=OFFICIAL') && url.includes('view=calendar'))).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:/29 de fevereiro de 2028: 12 aula/}));
  await screen.findByRole('heading',{name:'Aula compartilhada'});
  await waitFor(()=>expect(screen.getByRole('heading',{name:'Aulas de 29/02/2028'})).toHaveFocus());
  expect(fetch.mock.calls.some(([url])=>url.includes('from=2028-02-29') && url.includes('to=2028-02-29') && url.includes('mode=OFFICIAL'))).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Editar Aula compartilhada'}));
  expect(props.onEdit).toHaveBeenCalledWith(lesson);
  expect(screen.getByRole('link',{name:/Gerenciar chamada/})).toHaveAttribute('href','/#attendance=one');
  fireEvent.click(screen.getByRole('button',{name:'Próxima'}));
  await screen.findByRole('heading',{name:'Outra página'});
  fireEvent.click(screen.getByRole('button',{name:'Próximo mês'}));
  await screen.findByText('Nenhuma aula neste mês com os filtros atuais.');
  expect(screen.queryByRole('region',{name:'Aulas do dia selecionado'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Lista'}));
  await screen.findByRole('heading',{name:'Aula compartilhada'});
  expect(screen.getByLabelText('Modo')).toHaveValue('OFFICIAL');
});
test('CAL-04: calendar failure is explicit and does not invent empty days', async () => {
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('view=calendar')
    ? new Response(JSON.stringify({message:'Não foi possível carregar o mês.'}),{status:503})
    : new Response(JSON.stringify({items:[],pagination:{page:1,pages:1,pageSize:10,total:0}}))));
  render(<LessonList {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Calendário'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o mês.');
  expect(screen.queryByText('Nenhuma aula neste mês com os filtros atuais.')).not.toBeInTheDocument();
});
