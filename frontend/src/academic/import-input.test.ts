import { expect, it } from 'vitest';
import { normalizeImportInput } from './import-input';

it('converte células de planilha preservando espaços, vírgulas e identificador vazio', () => {
  expect(normalizeImportInput('nome\temail\tidentificador\tpapel\r\nAna Silva, Teste\tana@example.com\t\tALUNO'))
    .toBe('nome,email,identificador,papel\n"Ana Silva, Teste","ana@example.com","","ALUNO"');
});
it('aceita CSV com ponto e vírgula, BOM e aspas escapadas', () => {
  expect(normalizeImportInput('\uFEFFnome;email;identificador;papel\n"Ana ""Teste""; Silva";ana@example.com;001;ALUNO\n'))
    .toBe('nome,email,identificador,papel\n"Ana ""Teste""; Silva","ana@example.com","001","ALUNO"\n');
});
it('preserva CSV com vírgulas e não adivinha delimitadores por espaços', () => {
  const csv = 'nome,email,identificador,papel\n"Ana, Silva",ana@example.com,,ALUNO';
  expect(normalizeImportInput(csv)).toBe(csv);
  expect(normalizeImportInput('nome email identificador papel')).toBe('nome email identificador papel');
});
it('recusa campo com aspas sem fechamento', () => {
  expect(() => normalizeImportInput('nome;email;identificador;papel\n"Ana;ana@example.com;;ALUNO')).toThrow('sem fechamento');
});
