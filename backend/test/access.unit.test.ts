import test from 'node:test';
import assert from 'node:assert/strict';
import { adminOnly, isAdmin, checkVersion } from '../src/academic/access.js';
import { requirePermission, type Principal, type Role } from '../src/identity/authorization.js';
import { verifyPassword, sameSecret } from '../src/identity/password.js';

for (const roles of [[], ['STUDENT'], ['PROFESSOR'], ['STUDENT', 'PROFESSOR'],
  ['ADMIN'], ['OWNER'], ['STUDENT', 'ADMIN'], ['PROFESSOR', 'OWNER']] as Role[][]) {
  test(`R01: papéis acumulados ${roles.join('+') || 'nenhum'} respeitam guarda administrativa`, () => {
    const p: Principal = { id: 'synthetic', name: 'Teste', email: 'test@example.test', roles };
    const expected = roles.includes('ADMIN') || roles.includes('OWNER');
    assert.equal(isAdmin(p), expected);
    if (expected) {
      assert.doesNotThrow(() => adminOnly(p));
      assert.equal(requirePermission(p, 'installation:read'), p);
    } else {
      assert.throws(() => adminOnly(p), { status: 403, code: 'FORBIDDEN' });
      assert.throws(() => requirePermission(p, 'installation:read'), { status: 403 });
    }
  });
}

test('A52/A53 parcial: versão exata aceita; qualquer versão divergente gera conflito', () => {
  assert.doesNotThrow(() => checkVersion(0, 0));
  assert.doesNotThrow(() => checkVersion(3, 3));
  for (const supplied of [0, 2, 4])
    assert.throws(() => checkVersion(3, supplied), { status: 409, code: 'VERSION_CONFLICT' });
});

test('Identidade: hashes ausentes, truncados ou com algoritmo desconhecido não autenticam', async () => {
  for (const stored of ['', 'plain-password', 'bcrypt$x$y', 'scrypt-v1$$',
    `scrypt-v1$${'g'.repeat(32)}$${'a'.repeat(128)}`,
    `scrypt-v1$${'a'.repeat(32)}$${'b'.repeat(127)}`])
    assert.equal(await verifyPassword('synthetic password', stored), false);
});

test('Identidade: comparação de segredo preserva zeros, espaços e Unicode', () => {
  assert.equal(sameSecret('001234', '1234'), false);
  assert.equal(sameSecret('secret ', 'secret'), false);
  assert.equal(sameSecret('á', 'a'), false);
  assert.equal(sameSecret('á', 'á'), true);
});
