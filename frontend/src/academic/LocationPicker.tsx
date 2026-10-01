import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FormLabel } from '../FormValidation';
import { api } from '../api';

export function LocationPicker({ latitude, longitude, radius = 100 }: {
  latitude?: number; longitude?: number; radius?: number;
}) {
  const [lat, setLat] = useState(latitude?.toString() ?? '');
  const [lng, setLng] = useState(longitude?.toString() ?? '');
  const [meters, setMeters] = useState(String(radius));
  const [loaded, setLoaded] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [geoMessage, setGeoMessage] = useState('');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const [results, setResults] = useState<{ display_name: string; lat: number; lon: number }[]>([]);
  const searchId = useRef(0);
  const interacted = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const valid = lat !== '' && lng !== '' && Number.isFinite(+lat) && Number.isFinite(+lng)
    && Math.abs(+lat) <= 90 && Math.abs(+lng) <= 180;
  const select = (point: L.LatLng) => {
    if (container.current?.closest('fieldset')?.disabled) return;
    const wrapped = point.wrap();
    interacted.current = true;
    setLat(Math.max(-90, Math.min(90, wrapped.lat)).toFixed(6));
    setLng(wrapped.lng.toFixed(6));
    container.current?.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const selection = useRef(select);
  selection.current = select;
  async function searchAddress() {
    if (searching || query.trim().length < 3) return;
    const id = ++searchId.current;
    interacted.current = true;
    setSearching(true); setResults([]); setSearchMessage('');
    try {
      const found = await api<typeof results>(`/locations/search?q=${encodeURIComponent(query.trim())}`);
      if (id !== searchId.current) return;
      setResults(found); setSearchMessage(found.length ? 'Selecione um resultado e confira o ponto no mapa.' : 'Nenhum endereço encontrado. Inclua cidade e estado.');
    } catch (error) {
      if (id === searchId.current) setSearchMessage(error instanceof Error ? error.message : 'Busca indisponível.');
    } finally { if (id === searchId.current) setSearching(false); }
  }
  useEffect(() => () => { searchId.current++; }, []);
  useEffect(() => {
    if (!loaded || !container.current) return;
    const instance = L.map(container.current, { scrollWheelZoom: false, zoomControl: false });
    map.current = instance;
    instance.setView([-14.2, -51.9], 4);
    L.control.zoom({ zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(instance);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).on('tileerror', () => setTileError(true)).addTo(instance);
    instance.on('click', (event: L.LeafletMouseEvent) => selection.current(event.latlng));
    instance.on('dragstart zoomstart', () => { interacted.current = true; });
    let active = true;
    setGeoMessage('Buscando sua localização para aproximar o mapa…');
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(position => {
      if (!active) return;
      if (!interacted.current) instance.setView([position.coords.latitude, position.coords.longitude], 16);
      setGeoMessage('Localização obtida. Clique no mapa para escolher o ponto; nada foi salvo automaticamente.');
    }, () => {
      if (active) setGeoMessage('Não foi possível obter sua localização. Permita o acesso em HTTPS ou use a busca e o mapa.');
    }, { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false });
    else setGeoMessage('Localização indisponível neste navegador. Use a busca ou o mapa.');
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    return () => {
      active = false;
      observer.disconnect(); instance.remove(); map.current = null;
      marker.current = null; circle.current = null;
    };
  }, [loaded]);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!valid) {
      marker.current?.remove(); circle.current?.remove();
      marker.current = null; circle.current = null;
      return;
    }
    const point: L.LatLngTuple = [+lat, +lng];
    if (!marker.current) {
      marker.current = L.marker(point, {
        title: 'Local selecionado', keyboard: false,
        icon: L.divIcon({ className: 'location-pin', iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).addTo(instance);
      instance.setView(point, 16);
      // Initial display of saved coordinates is not a user navigation.
      if (latitude === +lat && longitude === +lng) interacted.current = false;
    } else { marker.current.setLatLng(point); instance.panTo(point, { animate: false }); }
    circle.current?.remove();
    circle.current = Number.isFinite(+meters) && +meters > 0
      ? L.circle(point, { radius: +meters, color: '#245a48', fillOpacity: 0.12 }).addTo(instance) : null;
  }, [loaded, lat, lng, meters, valid]);
  return <section className="location-picker" aria-label="Localização no mapa">
    <p>Clique no mapa para escolher o local. O círculo representa o raio permitido.</p>
    {!loaded && <button type="button" className="secondary" onClick={() => setLoaded(true)}>Selecionar no mapa</button>}
    <p className="muted">Ao carregar, o navegador solicitará sua localização para aproximar o mapa e se conectará ao OpenStreetMap. Isso não altera o local cadastrado. As coordenadas continuam editáveis sem o mapa.</p>
    {loaded && <>
      <p role="status">{geoMessage}</p>
      <FormLabel>Buscar endereço<input type="search" maxLength={200} value={query} placeholder="Rua, número, cidade e estado" onChange={e => { setQuery(e.target.value); setResults([]); searchId.current++; setSearching(false); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void searchAddress(); } }} /></FormLabel>
      <button type="button" className="secondary" disabled={searching || query.trim().length < 3} onClick={() => void searchAddress()}>{searching ? 'Buscando…' : 'Buscar endereço'}</button>
      <p className="muted">A busca envia o endereço ao provedor configurado. Não informe dados pessoais ou confidenciais. Resultados © OpenStreetMap contributors.</p>
      {searchMessage && <p role="status">{searchMessage}</p>}
      <ul className="location-results">{results.map((result, index) => <li key={index}><button type="button" className="secondary" onClick={() => { select(L.latLng(result.lat, result.lon)); setResults([]); }}>{result.display_name}</button></li>)}</ul>
      <div ref={container} className="location-map" aria-label="Mapa do local: use as setas para navegar e mais ou menos para ajustar o zoom" />
      {tileError && <p role="status">Não foi possível carregar parte do mapa. Verifique sua conexão ou utilize as coordenadas abaixo.</p>}
    </>}
    <div className="location-coordinates">
      <FormLabel>Latitude do local<input name="latitude" type="number" min={-90} max={90} step="any" required value={lat} onChange={e => setLat(e.target.value)} /></FormLabel>
      <FormLabel>Longitude do local<input name="longitude" type="number" min={-180} max={180} step="any" required value={lng} onChange={e => setLng(e.target.value)} /></FormLabel>
    </div>
    <FormLabel>Raio permitido (metros)<input name="radius" type="number" min="0.01" step="any" required value={meters} onChange={e => setMeters(e.target.value)} /></FormLabel>
  </section>;
}
