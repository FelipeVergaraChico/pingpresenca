// Only recognized headers select a delimiter; spaces in names are never separators.
export function normalizeImportInput(source: string): string {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const header = text.split('\n', 1)[0] ?? '';
  const delimiter = ['\t', ';'].find(value => header === ['nome', 'email', 'identificador', 'papel'].join(value));
  if (!delimiter) return text;
  let quoted = false;
  let closed = false;
  let result = '';
  let field = '';
  const flush = () => { result += `"${field.replaceAll('"', '""')}"`; field = ''; closed = false; };
  const body = text.slice(header.length + 1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') {
      if (quoted && body[i + 1] === '"') { field += '"'; i++; }
      else if (quoted) { quoted = false; closed = true; }
      else if (!field && !closed) quoted = true;
      else throw new Error('Confira as aspas dos campos da planilha.');
    } else if (!quoted && (c === delimiter || c === '\n')) {
      flush(); result += c === delimiter ? ',' : '\n';
    } else { if (closed) throw new Error('Confira as aspas dos campos da planilha.'); field += c; }
  }
  if (quoted) throw new Error('Confira as aspas: há um campo sem fechamento.');
  if (field || (body && !body.endsWith('\n'))) flush();
  return 'nome,email,identificador,papel\n' + result;
}

export const importTemplate = 'nome,email,identificador,papel\nAna Teste,ana.teste@example.com,TESTE-001,ALUNO\nProfessor Teste,professor.teste@example.com,TESTE-P01,PROFESSOR\n';
