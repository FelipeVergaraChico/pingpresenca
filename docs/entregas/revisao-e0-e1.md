# Revisão independente de E0 e E1

Data: 10/09/2026 · Código avaliado: `0.2.0-e1`, após a correção de mensagens por campo.

**Estado atual:** os sete achados abaixo foram [corrigidos e revalidados](correcoes-e0-e1.md). Este documento preserva a revisão inicial e suas falhas reproduzidas; os resultados atuais e o encerramento estão no relatório de correções.

## Parecer inicial (histórico)

**Não é correto afirmar que tudo está atendido. A revisão encontrou sete pontos a corrigir ou resolver antes de encerrar novamente a E1 e avançar para E2.** A suíte existente passa, mas os novos testes de regressão reproduzem falhas fora dos caminhos anteriormente exercitados.

A fundação da E0 passou novamente nos testes de bootstrap, sessões, persistência, autoridade temporal e migração. A integração E0 → E1 tem uma lacuna de diagnóstico com schema desatualizado. Na E1, há falhas de contexto de formulário, convite, atualização de interface e encerramento de matrícula.

Esta tarefa é uma revisão: **não foram alteradas regras, código de aplicação, migrations, `.env` ou banco da instalação**, nem implementada E2. Foram acrescentados este relatório e testes diagnósticos separados em `reviews/e0-e1/`. Os estados anteriores de conclusão nos relatórios são registros da avaliação anterior; este parecer acrescenta ressalvas, não considera as falhas corrigidas.

## Método e alcance

- Leitura do plano, especificação, critérios, ADRs, guias e evidências; confronto com backend, frontend, schema, configuração, scripts e testes existentes.
- Reexecução dos comandos de tipos, testes, build, integração, navegador e Compose.
- Regressões dirigidas a troca de recurso, resposta atrasada, troca de convite e falha após gravação. Os testes de interface usam componentes reais com transporte simulado; não equivalem a reproduções ponta a ponta com PostgreSQL.
- Provas HTTP com Fastify e PostgreSQL real em container exclusivo da revisão, sem ler `.env` nem aceitar uma URL externa de banco.
- Checagem adicional de autorização, concorrência, checksum de migração, dependências e consistência documental.

Prioridades: **P1** = risco de alteração sob contexto incorreto; **P2** = comportamento funcional/operacional incorreto que precisa ser tratado. Os identificadores REV abaixo são locais a esta revisão e não substituem R01–R29/A01–A95 do produto.

## Achados confirmados

### REV-01 · P1 · Editar turma pode enviar os dados da turma anterior

**Origem:** `frontend/src/academic/OfferingPanel.tsx`, formulário de edição, chave `offering-${offering.version}`.

Ao selecionar A e depois B, ambas na mesma versão, React reutiliza o formulário. Os inputs usam `defaultValue`, portanto continuam com nome, período, turno e modo de A, embora o cabeçalho e o destino da submissão sejam B.

**Prova:** o teste R01 observou POST para `/api/offerings/b` contendo `name: "Turma A"`. A expectativa de enviar `Turma B` falhou. A prova é do payload de interface; não foi aplicada essa alteração a dados reais.

**Impacto:** administrador pode sobrescrever B com informações de A. O versionamento não impede isso, pois a requisição utiliza a versão válida de B.

**Correção indicada:** associar a identidade do formulário ao ID e à versão do recurso; verificar também troca de recurso durante preenchimento. Relaciona-se ao contexto acadêmico inequívoco exigido pela E1 e a R06/R19.

### REV-04 · P1 · Convite novo pode ser aceito com a identidade antiga na tela

**Origem:** `frontend/src/Invitation.tsx`, estados `info`, `error`, `done` e efeito dependente de `token`; `App.tsx` reutiliza o componente quando o fragmento muda.

Abrir o convite A e trocar para o convite B na mesma página não limpa imediatamente os dados de A. Enquanto a inspeção de B está pendente, a tela continua mostrando A e o botão de aceite permanece disponível, mas a submissão já usa o token B.

**Prova:** o teste R04 atrasou a inspeção de B e conseguiu produzir uma requisição a `/api/invitations/accept` antes de a identidade de B ter sido apresentada. A expectativa de nenhuma submissão nessa situação falhou. Não é adivinhação de token nem bypass do vínculo no backend: o problema é a apresentação de uma conta diferente daquela que será ativada.

**Correção indicada:** reiniciar o estado por identidade do convite e só permitir aceite após inspeção bem-sucedida do token atual; tratar também troca após erro/sucesso. Relaciona-se a R03, A07 e mensagens/contexto compreensíveis da E1.

### REV-02 · P2 · Alterar o padrão da turma não atualiza o formulário de nova aula

**Origem:** `OfferingPanel.tsx`, chave do formulário de aula e `ModeField` com `defaultValue`.

Com o formulário de nova aula vazio, mudar a turma de PILOT para OFFICIAL atualiza o cabeçalho, mas mantém PILOT no seletor da nova aula. A chave não considera a mudança do padrão; não há reinicialização desse campo.

**Prova:** R02 forneceu a nova versão da turma com OFFICIAL; o campo permaneceu PILOT. Não se está propondo converter aulas existentes: o erro afeta o padrão de uma nova ocorrência, contrariando R08 e a ADR 0002/D07.

**Correção indicada:** sincronizar o padrão de novas aulas sem sobrescrever silenciosamente uma escolha explícita do usuário ou uma aula existente.

### REV-03 · P2 · Resposta atrasada de elegibilidade aparece na turma errada

**Origem:** `OfferingPanel.tsx`, botão de elegibilidade com `setPreview(await api(...))` sem conferir se a seleção continua a mesma.

Consultar a aula de A, trocar para B e receber a resposta depois da troca mostra os alunos/local de A sob o contexto de B.

**Prova:** R03 resolveu a resposta atrasada após selecionar B e encontrou `Aluno exclusivo A` na tela. A proteção existente em `load()` não abrange essa consulta.

**Impacto:** interpretação acadêmica incorreta. O teste não demonstra acesso a uma turma não autorizada: o ator tinha acesso a ambas.

**Correção indicada:** cancelar/descartar respostas obsoletas e identificar a aula na prévia. Relaciona-se ao contexto correto da E1, R06/R08.

### REV-05 · P2 · Gravação concluída é apresentada apenas como falha quando a lista não recarrega

**Origem:** `CatalogPanel.tsx` e outros callbacks que executam `await api(...)` seguido de `await refresh()` dentro do mesmo `onSave`; tratamento único em `ActionForm`.

Se o POST tem sucesso e somente a consulta de atualização falha, o formulário apresenta um erro sem avisar que o registro já foi salvo. Ele permanece apto a reenviar a criação. Para entidades sem chave de unicidade funcional, como disciplina/aula, isso pode induzir duplicação.

**Prova:** R05 simulou um POST bem-sucedido seguido de falha em `refresh()`. O único feedback foi `Falha ao recarregar a lista.`, sem indicação da gravação concluída. A duplicação é uma consequência possível de um novo clique, não um resultado de persistência medido por esse teste com mocks.

**Correção indicada:** separar resultado de gravação de falha de atualização; informar que salvou e oferecer repetição da consulta, não da criação. Relaciona-se às mensagens compreensíveis exigidas desde a E1.

### REV-06 · P2 · Instalação sem migração da E1 continua com health positivo

**Origem:** `backend/src/server.ts` inicializa a instalação sem verificar versão/checksums; `/api/health` em `app.ts` executa somente `SELECT 1`.

Com apenas a migration 001 aplicada, a fundação consegue inicializar, autenticar e responder health 200, mas a consulta de turmas retorna 500 porque as tabelas da E1 não existem. Os logs genéricos não indicam a migração faltante.

**Prova:** R06 criou exclusivamente o schema E0 em PostgreSQL sintético, inicializou a aplicação atual e observou `/api/offerings = 500` e `/api/health = 200`. Corresponde ao problema operacional relatado pelo mantenedor antes desta revisão.

**Classificação:** lacuna de diagnóstico/prontidão, não execução indevida de migração nem perda de dados. A documentação já pede migração explícita, e health atualmente é descrito como teste de conexão.

**Correção indicada:** verificação segura do schema esperado no startup/prontidão, com diagnóstico acionável. Não migrar automaticamente nem contornar backup obrigatório. Relaciona-se à fundação operacional E0/E1 e a R26.

### REV-07 · P2 · Matrícula com término futuro não pode ser encerrada antecipadamente

**Origem:** `backend/src/academic/routes.ts`, `if (before.ended_at)` recusa encerramento; `OfferingPanel.tsx` esconde a ação sempre que `ended_at` está preenchido.

É possível criar matrícula vigente com término planejado em 2099. Mesmo sem aula iniciada ou histórico fixado, tentar encerrar esse vínculo em uma data anterior retorna `409 ENROLLMENT_ALREADY_ENDED` e a mensagem de que o período já terminou.

**Prova:** R07 reproduziu esse resultado em PostgreSQL real. Preenchimento de um término futuro está sendo tratado como encerramento efetivo.

**Correção indicada:** distinguir término programado de período já encerrado, permitir a retirada acadêmica legítima com auditoria/versão e preservar os bloqueios históricos. Não reutilizar matrícula encerrada nem reabrir seu período. É uma restrição do fluxo já entregue de matrícula/encerramento que precisa ser conciliada com R07/A21/A24; não deve ser declarada atendida só porque a gestão temporal completa aparece na E5.

## Resultado dos testes

Ambiente: Linux, Node.js 22.17.0, npm 10.9.2, PostgreSQL 16 em Docker, Chrome para Playwright. Nenhum teste utilizou banco ou conta da instalação real.

| Execução | Resultado observado nesta revisão |
| --- | --- |
| `npm run typecheck` | Aprovado. |
| `npm test` | 13 backend + 11 frontend aprovados. |
| `npm run build` | Backend e frontend aprovados. |
| `npm run test:integration` | 20 subcenários aprovados; 22 resultados TAP incluindo os dois agregadores. |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:browser` | 1 fluxo aprovado; 20,3 s de cenário, 31,2 s totais. Sete análises axe, teclado e recortes móveis existentes passaram. |
| `npm run test:compose` | Aprovado: build, migrations, bootstrap/login, recriação com persistência e limpeza. |
| Regressões diagnósticas de interface | **5 falhas reproduzidas**; confirmadas também numa segunda execução com verificação dos payloads de troca de turma/convite. |
| Provas adicionais de backend | **2 falhas reproduzidas e 4 subcenários aprovados**. O TAP inclui também o agregador reprovado: 7 resultados, dos quais 3 falham contando esse agregador. |
| `npm audit --json` | Nenhum aviso de vulnerabilidade retornado pelo registro no momento da consulta. Não comprova segurança integral nem compatibilidade de licenças. |
| Documentação/manifests | 11 documentos prévios com links locais/blocos válidos; versões/dependências dos três manifests coerentes com lockfile e identificador AGPL-3.0-only. |

As provas adicionais aprovadas verificaram **63 requisições diretas** negadas a visitante, aluno e professor não vinculado; perda de autorização após remover vínculo docente; resposta do aluno sem política/colegas; duas edições da mesma versão produzindo somente uma alteração e um evento; recusa de checksum de migration adulterado. Não se encontrou bypass nessas rotas exercitadas.

Houve aviso transitório de conexão recusada do proxy durante a inicialização do ambiente Playwright; o teste aguardou a prontidão e terminou aprovado. As sete falhas diagnósticas são distintas desse aviso e de restrições de infraestrutura.

## O que foi entregue e o que continua pendente

| Parte do plano | Conclusão da revisão |
| --- | --- |
| E0: stack, workspaces, decisões técnicas, configuração, fuso, bootstrap único | Implementação e testes existentes corroborados. |
| E0: sessões, autoridade do backend, auditoria transacional e persistência | Corroborados nos cenários executados, sem promessa de auditoria de segurança exaustiva. |
| E0/E1: instalação/migração | Fluxo documentado funciona; acrescentar ressalva REV-06 para banco desatualizado. |
| E1: gestão individual, hierarquia, convites manuais | Backend corroborado nos recortes entregues; interface de convite tem REV-04. |
| E1: disciplina, oferta, vínculo docente, matrícula e aula avulsa | Implementados; REV-01/02/03/05/07 impedem aprovação sem ressalvas. |
| E1: mensagens acessíveis por campo | Correção anterior continua passando; ainda há estados assíncronos e sucesso/erro inadequados nesta revisão. A83 completo não foi comprovado por leitor de tela humano. |
| E1: elegibilidade e prévia da política | Regras e restrições existentes testadas; prévia não é snapshot histórico persistido de abertura. REV-03 afeta sua apresentação. |
| E2/E3: chamada, QR, presença, pendências, frequência, reabertura e concorrência de presença | Ainda não implementados; adiamento explícito, não esquecimento da E0/E1. |
| E5: recorrência, importação, SMTP, recuperação completa, arquivamento, consolidação manual e exclusões | Continuam no plano. Não são apresentados como aprovados por fundações compartilhadas. |
| E3/E4/E6: leitor de tela humano, HTTPS real, backup/restauração, piloto, carga e distribuição | Evidência completa ainda pendente; não se executaram campanha de carga, piloto ou certificado público nesta revisão. |

Não foram instalados PostgreSQL nativo, leitores de tela ou serviços externos. O teste Compose usou cache de camadas quando disponível; não se afirma reinstalação de dependências sem cache nesta revisão. A verificação de Git continua indisponível (`not a git repository`); não houve reparo/commit nem comprovação por Git de quais arquivos estão versionados.

## Reproduzir e encerrar os achados

Na revisão inicial, os testes ficaram fora da suíte padrão e retornaram falha no código então revisado. Após as correções, foram promovidos às suítes permanentes e devem passar. As expectativas de comportamento correto foram preservadas e ampliadas; não foram alteradas para aceitar os defeitos.

Na raiz do repositório, com dependências instaladas:

```sh
node node_modules/vitest/vitest.mjs run --config reviews/e0-e1/vitest.config.ts --reporter=verbose
npm run build
node --test backend/test/review-regressions.test.mjs
```

Fontes atuais: [regressões de interface](../../frontend/src/academic/ReviewRegressions.test.tsx), [configuração isolada](../../reviews/e0-e1/vitest.config.ts) e [provas de backend](../../backend/test/review-regressions.test.mjs). O último script exige Docker e cria/remove exclusivamente seu próprio banco sintético. Também fazem parte de `npm test` e `npm run test:integration`, respectivamente.

A recomendação inicial de corrigir e revalidar os sete pontos foi atendida no [relatório de correções](correcoes-e0-e1.md). A E2 permanece não iniciada. A revisão não garante ausência de outros defeitos; registra o que foi efetivamente inspecionado e reproduzido.
