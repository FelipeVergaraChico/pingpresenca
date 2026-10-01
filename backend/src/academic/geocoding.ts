import { z } from 'zod';
import { AppError } from '../platform/errors.js';

const results = z.array(z.object({
  display_name: z.string().max(2000),
  lat: z.coerce.number().finite().min(-90).max(90),
  lon: z.coerce.number().finite().min(-180).max(180),
})).max(5);

// One API process per installation. No autocomplete, queue or background requests.
export function createGeocoder(endpoint: string, origin: string, request = fetch, now = Date.now) {
  let busy = false, next = 0;
  const cache = new Map<string, { until: number; value: z.infer<typeof results> }>();
  return async (query: string) => {
    if (!endpoint) throw new AppError(503, 'GEOCODING_DISABLED', 'Busca de endereço não configurada. Use o mapa ou as coordenadas.');
    const key = query.trim().toLocaleLowerCase();
    const saved = cache.get(key);
    if (saved && saved.until > now()) return saved.value;
    if (busy || now() < next) throw new AppError(429, 'GEOCODING_BUSY', 'Aguarde um instante antes de buscar novamente.');
    busy = true; next = now() + 1100;
    try {
      const url = new URL(endpoint);
      url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', 'accept-language': 'pt-BR' }).toString();
      const response = await request(url, { headers: { 'User-Agent': `PingPresenca/0.4 (${origin})` }, signal: AbortSignal.timeout(7000), redirect: 'error' });
      if (!response.ok) throw new Error('provider unavailable');
      const value = results.parse(await response.json());
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(key, { until: now() + 3600000, value });
      return value;
    } catch {
      throw new AppError(502, 'GEOCODING_UNAVAILABLE', 'Busca de endereço indisponível. Tente mais tarde ou selecione no mapa.');
    } finally { busy = false; }
  };
}
