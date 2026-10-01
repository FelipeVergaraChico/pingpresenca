// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { LocationPicker } from './LocationPicker';
import { ActionForm } from './Form';
import { api } from '../api';
vi.mock('../api', async importOriginal => ({ ...await importOriginal<object>(), api: vi.fn() }));

const mocks = vi.hoisted(() => {
  const instance = { setView: vi.fn(), panTo: vi.fn(), on: vi.fn(), remove: vi.fn(), invalidateSize: vi.fn(), getCenter: () => ({ wrap: () => ({ lat: -22, lng: -44 }) }) };
  const layer = { addTo: vi.fn().mockReturnThis(), on: vi.fn().mockReturnThis(), remove: vi.fn(), setLatLng: vi.fn() };
  return { instance, layer, map: vi.fn(() => instance), circle: vi.fn(() => layer) };
});
vi.mock('leaflet', () => ({ default: {
  map: mocks.map, tileLayer: () => mocks.layer, marker: () => mocks.layer,
  divIcon: vi.fn(), circle: mocks.circle, control: { zoom: () => mocks.layer },
  latLng: (lat: number, lng: number) => ({ wrap: () => ({ lat, lng }) }),
} }));
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('não seleciona coordenadas nem solicita mapas antes da ação explícita', () => {
  render(<LocationPicker />);
  expect(mocks.map).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Latitude do local') as HTMLInputElement).value).toBe('');
});
it('sincroniza seleção no mapa, campos e raio enviado pelo formulário', async () => {
  const save = vi.fn(async (_data: FormData) => {});
  render(<ActionForm onSave={save}><LocationPicker /></ActionForm>);
  fireEvent.click(screen.getByText('Selecionar no mapa'));
  const click = mocks.instance.on.mock.calls.find(call => call[0] === 'click')![1];
  act(() => click({ latlng: { wrap: () => ({ lat: -23.5, lng: -46.6 }) } }));
  fireEvent.change(screen.getByLabelText('Raio permitido (metros)'), { target: { value: '250' } });
  await act(async () => { fireEvent.submit(screen.getByText('Salvar').closest('form')!); });
  expect(save.mock.calls[0]![0].get('latitude')).toBe('-23.500000');
  expect(save.mock.calls[0]![0].get('longitude')).toBe('-46.600000');
  expect(save.mock.calls[0]![0].get('radius')).toBe('250');
  expect(mocks.circle).toHaveBeenLastCalledWith([-23.5, -46.6], expect.objectContaining({ radius: 250 }));
});
it('remove botão de centro e libera o mapa ao desmontar', () => {
  render(<StrictMode><LocationPicker latitude={0} longitude={0} /></StrictMode>);
  fireEvent.click(screen.getByText('Selecionar no mapa'));
  expect(screen.queryByText('Usar centro do mapa')).toBeNull();
  cleanup();
  expect(mocks.instance.remove).toHaveBeenCalled();
});
it('mantém o caminho numérico sem depender do serviço de mapas', () => {
  render(<LocationPicker latitude={-23} longitude={-46} />);
  fireEvent.change(screen.getByLabelText('Latitude do local'), { target: { value: '-24' } });
  expect((screen.getByLabelText('Latitude do local') as HTMLInputElement).value).toBe('-24');
  expect(mocks.map).not.toHaveBeenCalled();
});
it('informa indisponibilidade sem impedir edição manual', () => {
  render(<LocationPicker />);
  fireEvent.click(screen.getByText('Selecionar no mapa'));
  act(() => mocks.layer.on.mock.calls.find(call => call[0] === 'tileerror')![1]());
  expect(screen.getByText(/Verifique sua conexão/)).toBeTruthy();
  expect((screen.getByLabelText('Latitude do local') as HTMLInputElement).disabled).toBe(false);
});
it('solicita GPS ao abrir e centraliza sem preencher coordenadas', () => {
  const getCurrentPosition = vi.fn();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
  render(<LocationPicker />);
  expect(getCurrentPosition).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Selecionar no mapa'));
  act(() => getCurrentPosition.mock.calls[0]![0]({ coords: { latitude: -22, longitude: -44 } }));
  expect(mocks.instance.setView).toHaveBeenLastCalledWith([-22, -44], 16);
  expect((screen.getByLabelText('Latitude do local') as HTMLInputElement).value).toBe('');
});
it('busca somente ao confirmar e seleciona resultado sem submeter cadastro', async () => {
  vi.mocked(api).mockResolvedValue([{ display_name: 'Praça de teste', lat: -22, lon: -44 }]);
  const save = vi.fn(async (_data: FormData) => {});
  render(<ActionForm onSave={save}><LocationPicker /></ActionForm>);
  fireEvent.click(screen.getByText('Selecionar no mapa'));
  fireEvent.change(screen.getByLabelText('Buscar endereço'), { target: { value: 'Praça, cidade' } });
  expect(api).not.toHaveBeenCalled();
  await act(async () => { fireEvent.keyDown(screen.getByLabelText('Buscar endereço'), { key: 'Enter' }); });
  fireEvent.click(screen.getByText('Praça de teste'));
  expect((screen.getByLabelText('Longitude do local') as HTMLInputElement).value).toBe('-44.000000');
  expect(save).not.toHaveBeenCalled();
});
it('negação de GPS mantém o mapa e informa a alternativa', () => {
  const getCurrentPosition = vi.fn();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
  render(<LocationPicker />);
  fireEvent.click(screen.getByText('Selecionar no mapa'));
  act(() => getCurrentPosition.mock.calls[0]![1]({ code: 1 }));
  expect(screen.getByText(/Não foi possível obter sua localização/)).toBeTruthy();
  expect(screen.getByLabelText('Buscar endereço')).toBeTruthy();
});
it('GPS tardio não reposiciona depois que a pessoa navegou', () => {
  const getCurrentPosition = vi.fn();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
  render(<LocationPicker />);
  fireEvent.click(screen.getByText('Selecionar no mapa'));
  act(() => mocks.instance.on.mock.calls.find(call => call[0] === 'dragstart zoomstart')![1]());
  mocks.instance.setView.mockClear();
  act(() => getCurrentPosition.mock.calls[0]![0]({ coords: { latitude: -22, longitude: -44 } }));
  expect(mocks.instance.setView).not.toHaveBeenCalled();
});
it('ignora seleção enquanto o formulário está bloqueado por salvamento', () => {
  const { rerender } = render(<fieldset><LocationPicker /></fieldset>);
  fireEvent.click(screen.getByText('Selecionar no mapa'));
  rerender(<fieldset disabled><LocationPicker /></fieldset>);
  act(() => mocks.instance.on.mock.calls.find(call => call[0] === 'click')![1]({ latlng: { wrap: () => ({ lat: 10, lng: 20 }) } }));
  expect((screen.getByLabelText('Latitude do local') as HTMLInputElement).value).toBe('');
});
