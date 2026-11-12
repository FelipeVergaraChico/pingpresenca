import { useId, useState } from 'react';
import { api } from '../api';
import { displayTime, type Offering } from './types';
import { importTemplate, normalizeImportInput } from './import-input';

type Preview = { target?: { name: string; enrolledAt: string | null; endedAt: string | null; timeZone: string } | null; previewHash: string; valid: boolean; rows: { record: number; name: string; email: string; institutionalId: string | null; role: string; errors: string[] }[] };
type Invite = { accountId: string; name: string; email: string; url: string; expiresAt: string };
export function AccountImportPanel({ refresh, offerings = [], timeZone = 'America/Sao_Paulo' }: { refresh: () => Promise<void>; offerings?: Offering[]; timeZone?: string }) {
  const csvId = useId();
  const fileId = useId();
  const [csv, setCsv] = useState('nome,email,identificador,papel\n');
  const [preview, setPreview] = useState<Preview>();
  const [requestId, setRequestId] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [offeringId, setOfferingId] = useState('');
  const [enrolledLocal, setEnrolledLocal] = useState('');
  const [endedLocal, setEndedLocal] = useState('');
  const [batchId, setBatchId] = useState('');
  const [links, setLinks] = useState<Invite[]>([]);
  const [inviteRequest, setInviteRequest] = useState('');
  const [replace, setReplace] = useState(false);
  const [linkPage, setLinkPage] = useState(0);
  function invalidate() { setPreview(undefined); setMessage(''); }
  async function loadFile(file: File) {
    invalidate(); setBusy(true);
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error('Selecione um arquivo .csv. No Excel ou LibreOffice, salve como CSV UTF-8.');
      if (file.size > 65536) throw new Error('O arquivo excede 64 KiB. Divida as contas em lotes menores.');
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo. Selecione-o novamente.'));
        reader.readAsText(file, 'UTF-8');
      });
      if (text.includes('\uFFFD')) throw new Error('O arquivo contém caracteres inválidos. Salve como CSV UTF-8 e tente novamente.');
      const normalized = normalizeImportInput(text);
      if (new TextEncoder().encode(normalized).length > 65536) throw new Error('Os dados convertidos excedem 64 KiB. Divida o lote.');
      setCsv(normalized);
      setMessage(`Arquivo ${file.name} carregado. Visualize a prévia; nenhuma conta foi criada.`);
    } catch (error) { setCsv(''); setMessage(error instanceof Error ? error.message : 'Não foi possível ler o arquivo.'); }
    finally { setBusy(false); }
  }
  async function run(confirm: boolean) {
    setBusy(true); setMessage('');
    try {
      const normalized = normalizeImportInput(csv);
      if (new TextEncoder().encode(normalized).length > 65536) throw new Error('Os dados excedem 64 KiB. Divida o lote.');
      if (!confirm) {
        setPreview(undefined);
        const result = await api<Preview>('/admin/accounts/import/preview', { csv: normalized, offeringId: offeringId || null, enrolledLocal: offeringId ? enrolledLocal || null : null, endedLocal: offeringId ? endedLocal || null : null });
        setPreview(result); setPage(0); setRequestId(crypto.randomUUID());
      } else {
        const result = await api<{ created: number; batchId: string }>('/admin/accounts/import/confirm', { csv: normalized, previewHash: preview!.previewHash, requestId, offeringId: offeringId || null, enrolledLocal: offeringId ? enrolledLocal || null : null, endedLocal: offeringId ? endedLocal || null : null });
        setPreview(undefined); setNeedsRefresh(true);
        setBatchId(result.batchId); setInviteRequest(crypto.randomUUID()); setLinks([]); setReplace(false);
        setMessage(`${result.created} conta(s) criada(s)${offeringId ? ' e vinculada(s) à turma' : ''}. Agora você pode gerar os convites do lote.`);
        try { await refresh(); setNeedsRefresh(false); }
        catch { setMessage('Importação concluída. Atualize a lista de contas; não repita o cadastro.'); }
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível importar.'); }
    finally { setBusy(false); }
  }
  async function invite() {
    setBusy(true); setMessage(''); setLinks([]);
    try {
      const result = await api<{ links: Invite[]; skipped: number }>(`/admin/accounts/import/${batchId}/invitations`, { requestId: inviteRequest, replaceExisting: replace });
      setLinks(result.links); setLinkPage(0); setReplace(false);
      setMessage(`Convites gerados. ${result.skipped} conta(s) já ativada(s) ou inativa(s) ignorada(s). Entregue cada link somente à pessoa indicada.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao gerar convites.'); }
    finally { setBusy(false); }
  }
  return <details className="editor import-editor">
    <summary>Importar contas por CSV</summary>
    <p>Selecione um CSV UTF-8 ou cole as células da sua planilha, incluindo o cabeçalho. Até 200 novas contas por lote (64 KiB). Nenhuma conta existente é alterada.</p>
    <p>Exemplo: <code>Ana Silva,ana@example.com,123,ALUNO</code>. Identificador pode ficar vazio quando a política permitir. Escolha uma turma para vincular o lote ou deixe sem vínculo.</p>
    <fieldset disabled={busy || needsRefresh}>
      <legend>Dados e destino do lote</legend>
      <div className="import-file-picker">
        <label htmlFor={fileId}>Selecionar arquivo CSV</label>
        <input id={fileId} type="file" accept=".csv,text/csv" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void loadFile(file); }} />
        <p>Separadores aceitos: vírgula, ponto e vírgula ou tabulação. Arquivos Excel (.xlsx) devem ser salvos como CSV UTF-8.</p>
        <a className="button-link secondary" download="modelo-importacao-contas.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(importTemplate)}`}>Baixar modelo CSV</a>
      </div>
      <div><label htmlFor={csvId}>Dados CSV</label><textarea id={csvId} rows={7} maxLength={65536} value={csv} onChange={e => { setCsv(e.target.value); invalidate(); }} /></div>
      <label>Turma do lote (opcional)<select value={offeringId} onChange={e => { setOfferingId(e.target.value); invalidate(); }}>
        <option value="">Sem vínculo acadêmico</option>{offerings.filter(o => o.active).map(o => <option key={o.id} value={o.id}>{o.name} · {o.term}</option>)}
      </select></label>
      {offeringId && <><p>Alunos serão matriculados; professores serão acrescentados sem remover os atuais. Horários no fuso {timeZone}.</p>
        <label>Início das matrículas<input type="datetime-local" value={enrolledLocal} onChange={e => { setEnrolledLocal(e.target.value); invalidate(); }} /></label>
        <label>Término das matrículas (opcional)<input type="datetime-local" value={endedLocal} onChange={e => { setEndedLocal(e.target.value); invalidate(); }} /></label>
        <p>O início é obrigatório se houver alunos. Não é permitido incluir alunos retroativamente em chamadas já iniciadas.</p></>}
      <button type="button" className="primary" onClick={() => void run(false)}>Visualizar prévia da importação</button>
      {preview && <section aria-label="Prévia da importação">
        <p role="status">{preview.rows.length} conta(s). {preview.valid ? 'Prontas para revisão e confirmação.' : 'Corrija os erros antes de importar. Nenhuma conta foi criada.'}</p>
        {preview.target && <p>Destino: <strong>{preview.target.name}</strong>. {preview.target.enrolledAt && <>Matrículas de {displayTime(preview.target.enrolledAt, preview.target.timeZone)} até {preview.target.endedAt ? displayTime(preview.target.endedAt, preview.target.timeZone) : 'sem término definido'}.</>}</p>}
        <ol start={page * 10 + 1}>{preview.rows.slice(page * 10, page * 10 + 10).map(row => <li key={row.record}>
          <strong>{row.name}</strong> · {row.email} · {row.role === 'STUDENT' ? 'Aluno' : 'Professor'} · {row.institutionalId ?? 'Sem identificador'}
          {row.errors.map(error => <p className="message" key={error}>{error}</p>)}
        </li>)}</ol>
        <div className="actions"><button type="button" className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
          <span>Página {page + 1} de {Math.ceil(preview.rows.length / 10)}</span>
          <button type="button" className="secondary" disabled={(page + 1) * 10 >= preview.rows.length} onClick={() => setPage(page + 1)}>Próxima</button></div>
        <button type="button" className="primary" disabled={!preview.valid} onClick={() => void run(true)}>Confirmar criação das contas</button>
      </section>}
    </fieldset>
    {message && <p role="status" className="message">{message}</p>}
    {needsRefresh && <button type="button" className="secondary" disabled={busy} onClick={async () => { setBusy(true); try { await refresh(); setNeedsRefresh(false); } catch { setMessage('Não foi possível atualizar a lista. Tente novamente.'); } finally { setBusy(false); } }}>Atualizar lista de contas</button>}
    {batchId && <section aria-label="Convites do lote" className="import-invitations">
      <h3>Convites do último lote confirmado</h3>
      <p>Links manuais, individuais e válidos por 48 horas. Não verificam o e-mail. Copie antes de sair: os links completos não são guardados no servidor. Contas ativadas ou inativas são ignoradas.</p>
      <label className="checkbox-label"><input type="checkbox" disabled={busy} checked={replace} onChange={e => { setReplace(e.target.checked); if (e.target.checked) setInviteRequest(crypto.randomUUID()); }} />Autorizo uma nova emissão e a invalidação dos convites anteriores deste lote.</label>
      <button type="button" className="primary" disabled={busy || (links.length > 0 && !replace)} onClick={() => void invite()}>{replace ? 'Substituir convites do lote' : 'Gerar convites do lote'}</button>
      <ul>{links.slice(linkPage * 10, linkPage * 10 + 10).map(link => <li key={link.accountId}>
        <label>{link.name} · {link.email}<input readOnly value={link.url} onFocus={e => e.target.select()} /></label>
        <p>Expira em {displayTime(link.expiresAt, timeZone)}.</p>
      </li>)}</ul>
      {links.length > 10 && <div className="actions"><button type="button" className="secondary" disabled={busy || linkPage === 0} onClick={() => setLinkPage(linkPage - 1)}>Convites anteriores</button><span>Página {linkPage + 1} de {Math.ceil(links.length / 10)}</span><button type="button" className="secondary" disabled={busy || (linkPage + 1) * 10 >= links.length} onClick={() => setLinkPage(linkPage + 1)}>Próximos convites</button></div>}
    </section>}
  </details>;
}
