import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeocoder } from '../src/academic/geocoding.js';

test('geocoding: desativado por padrão, sem chamada externa', async () => {
  await assert.rejects(createGeocoder('', '')('Rua teste'), /não configurada/);
});
test('geocoding: cache e limite agregado entre buscas', async () => {
  let calls = 0;
  const request = (async () => { calls++; return new Response(JSON.stringify([{ display_name: 'Teste', lat: '0', lon: '0' }])); }) as typeof fetch;
  const search = createGeocoder('https://example.test/search', 'https://app.test', request, () => 2000);
  assert.equal((await search('Rua Teste'))[0]?.lat, 0);
  await search('rua teste');
  assert.equal(calls, 1);
  await assert.rejects(search('Outra rua'), /Aguarde/);
});
test('geocoding: erro do provedor não expõe dados e permite tentar depois', async () => {
  const request = (async () => new Response('erro privado', { status: 500 })) as typeof fetch;
  await assert.rejects(createGeocoder('https://example.test/search', '', request)('Rua'), /indisponível/);
});
