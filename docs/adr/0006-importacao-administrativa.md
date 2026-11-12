# ADR 0006 — Importação administrativa e convites em lote

Data: 21/10/2026. Estado: adotada para E5.2. Complementa D04; SMTP permanece separado.

## Decisão

- CSV UTF-8 limitado a 200 novas contas/64 KiB; cabeçalho fixo, papéis ALUNO/PROFESSOR e mensagens por registro. Não mesclar contas por nome/e-mail nem mudar privilégios de contas existentes.
- Cada lote pode escolher uma turma ativa, ou nenhuma. Alunos recebem matrícula com início obrigatório e término opcional, no fuso da instalação; professores são acrescentados sem remover os já vinculados. Lotes para outras turmas são separados; vínculos posteriores de contas existentes continuam no cadastro acadêmico.
- Prévia somente leitura, confirmação explícita e revalidação transacional. A prévia contém o destino e a vigência convertida pelo servidor. Alterações na política/turma invalidam a prévia. Chamadas cujo contexto já foi fixado impedem matrícula retroativa; o mesmo bloqueio administrativo usado pelas operações acadêmicas serializa a importação com a abertura da chamada.
- Contas, papéis, vínculos e auditoria são gravados na mesma transação. O evento de lote associa IDs, ator e hash da solicitação, sem copiar dados pessoais ou CSV para seus detalhes. Reenvio da mesma chave e conteúdo pelo mesmo ator retorna o resultado anterior, sem novos vínculos.
- Emissão de convites é uma ação posterior, não efeito automático de reenvio da importação. Reutiliza o emissor individual de links manuais de 48 horas; apenas hashes dos tokens são persistidos. O aceite preserva os papéis/vínculos e não verifica o e-mail.
- Todos os alvos são reautorizados na emissão. Contas ativas ainda não aceitas são elegíveis; ativadas/inativas são ignoradas com contagem. Se qualquer conta adquiriu papel ADMIN/OWNER, o lote exige gestão individual, mesmo para owner: não usar a operação em lote como atalho da hierarquia.
- Uma emissão com a mesma chave nunca é repetida. Se a resposta se perder, os links não são recuperados do banco: o administrador confirma uma nova emissão, com nova chave e aviso de invalidação dos anteriores. Convites válidos já existentes impedem emissão sem autorização explícita de substituição. Uma falha de auditoria desfaz também a revogação dos links anteriores.
- Respostas de importação/convites usam `Cache-Control: no-store`. Links ficam apenas no estado temporário da interface; não são persistidos em localStorage nem auditados em texto puro. Entregar cada link somente à pessoa indicada.

## Consequências e limites

Não há migration nova na E5.2; a 006 da recorrência permanece necessária no checkout atual. Retenção futura deverá preservar ou substituir o registro de idempotência antes de apagar eventos. O lote é limitado e sua prévia/resultado é paginado em dez itens no cliente; não foi criado histórico ilimitado de lotes. O seletor usa as turmas já carregadas pela área administrativa; revisão de paginação dos catálogos existentes continua uma tarefa transversal.

O formulário aceita seleção de arquivo CSV UTF-8 (até 64 KiB), além da colagem. Arquivos são lidos localmente e somente o texto é enviado à API na solicitação de prévia. Cabeçalhos reconhecidos separados por ponto e vírgula ou tabulação (cópia de planilhas) são normalizados para CSV com vírgulas, preservando campos vazios e valores entre aspas. Espaços não são interpretados como separadores. O backend mantém a validação autoritativa e a confirmação explícita. Há um modelo CSV para download; arquivos Excel devem ser exportados como CSV UTF-8.

SMTP, reimportação para atualizar usuários existentes e recuperação de links em texto puro não são oferecidos por este recorte. O requisito de importação do MVP não pressupõe atualização automática de contas existentes.

## Evidências

`account-import.unit.test.ts`, cenários E5.2 em `e1.integration.test.ts`, `AccountImportPanel.test.tsx` e fluxo E5.2 em `e2e/bootstrap.spec.ts`. Relatório de execução em [E5.2](../entregas/e5-2.md). Não confundir esses testes com aceite humano ou certificação de desempenho E6.
