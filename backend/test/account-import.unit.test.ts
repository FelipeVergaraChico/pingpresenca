import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAccountCsv } from '../src/identity/import.js';
const header = 'nome,email,identificador,papel\n';
test('R03 importação: CSV com BOM, CRLF, aspas, vírgulas e e-mail normalizado', () => {
  const [row] = parseAccountCsv('\uFEFF' + header + '"Ana, ""Silva""",ANA@example.com,,ALUNO\r\n');
  assert.equal(row!.name, 'Ana, "Silva"'); assert.equal(row!.email, 'ana@example.com');
  assert.deepEqual(row!.errors, []); assert.equal(row!.institutionalId, null);
});
test('A05/A06: erros por registro e proibição de papéis privilegiados', () => {
  const [row] = parseAccountCsv(header + 'A,invalid,,OWNER');
  assert.equal(row!.errors.length, 3);
});
test('CSV inválido, vazio, delimitador diferente e limites rejeitados', () => {
  for (const text of [header, header + '"unfinished', header + '"Ana"x,a@b.com,,ALUNO', header.replaceAll(',', ';'), header + 'x'.repeat(65536), header + 'Ana,a@b.com,,ALUNO\n'.repeat(201)]) assert.throws(() => parseAccountCsv(text));
});
