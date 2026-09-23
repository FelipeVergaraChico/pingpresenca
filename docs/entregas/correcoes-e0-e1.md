# Correções da revisão E0/E1

Data: 10/09/2026 · Versão: `0.2.0-e1` · Estado: **sete achados corrigidos e revalidados**. E2 não iniciada.

Este registro encerra os achados da [revisão E0/E1](revisao-e0-e1.md), preservando suas evidências históricas. Não altera os requisitos do MVP nem amplia a cobertura declarada de entregas futuras.

## Correções e evidências

| Achado | Correção | Regressão executada |
| --- | --- | --- |
| REV-01 | Contexto dos formulários vinculado ao ID da turma; edição também usa a versão. | Troca A → B com mesma versão envia os dados de B para B. |
| REV-02 | Modo inicial acompanha o padrão atualizado enquanto não houver escolha explícita. | Novo padrão aplicado; escolha explícita e demais campos do rascunho preservados. |
| REV-03 | Prévia identifica a aula e descarta respostas/erros obsoletos por seleção e ordem da solicitação. | Resposta de A não aparece em B; erro antigo não substitui resultado mais recente. |
| REV-04 | Componente de convite isolado por token, com aceite disponível só após inspeção atual. | Trocas durante inspeção, após erro/sucesso e durante aceite; conclusão antiga não altera a URL do novo convite. |
| REV-05 | Resultado da gravação separado da atualização de leitura. Falha posterior informa que salvou e oferece repetir somente a consulta. | Reenvio bloqueado; retry não faz novo POST. Chrome/API/PostgreSQL confirmam uma única disciplina após falha de consulta. |
| REV-06 | Verificação somente de leitura de nomes/checksums no startup e health; 503 para schema incompatível. | Banco vazio, somente E0, schema correto, migration desconhecida e checksum divergente. Nenhuma migração automática nem exposição de senha. |
| REV-07 | Término futuro pode ser antecipado; período já encerrado não é reaberto. Backend calcula `can_end` pelo relógio do PostgreSQL. | Limites históricos, proibição de prorrogação, conflito de versão, antes/depois auditados, duas edições concorrentes e rollback em falha de auditoria. |

Para REV-07, somente o intervalo de participação removido é verificado: uma aula fixada no término anterior exclusivo não bloqueia uma antecipação legítima. Datas de início continuam imutáveis por esse fluxo. Não foi criado endpoint de reabertura ou de edição retroativa irrestrita.

Para REV-05, a proteção é de interface após uma resposta de gravação bem-sucedida; não é uma promessa de idempotência distribuída para respostas de POST perdidas. Ações deliberadamente repetíveis, como gerar outro convite, continuam disponíveis depois da conclusão, sem execução simultânea.

## Arquivos principais

- [OfferingPanel](../../frontend/src/academic/OfferingPanel.tsx), [ActionForm/ModeField](../../frontend/src/academic/Form.tsx), [Invitation](../../frontend/src/Invitation.tsx), painéis de catálogo, contas e configurações, e tipo de matrícula.
- [Prontidão de schema](../../backend/src/db/readiness.ts), [manifesto de migrations](../../backend/src/db/migrate.ts), startup, health e [rotas acadêmicas](../../backend/src/academic/routes.ts).
- [Regressões de interface](../../frontend/src/academic/ReviewRegressions.test.tsx), [regressões de backend](../../backend/test/review-regressions.test.mjs), [fluxo de navegador](../../e2e/bootstrap.spec.ts) e scripts npm.

As regressões de UI saíram da pasta de diagnóstico e entram em `npm test`. As provas de PostgreSQL também foram promovidas para `backend/test` e entram em `npm run test:integration`, com banco/container sintéticos próprios. Execução isolada: `npm run test:regression:backend`.

## Validação

Ambiente: Node.js 22.17.0, npm 10.9.2, PostgreSQL 16 em Docker e Chrome. Resultados finais:

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | Backend e frontend aprovados. |
| `npm test` | 13 testes backend + 22 frontend aprovados; 11 dos testes de frontend são regressões desta revisão. |
| `npm run build` | Backend e frontend aprovados. |
| `npm run test:integration` | 20 subcenários anteriores + 9 regressões adicionais em PostgreSQL; 29 subcenários, sem contar agregadores TAP. |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:browser` | 1 fluxo ponta a ponta aprovado em 18,5 s; 27,3 s totais. Oito análises axe, teclado e recortes móveis existentes. |
| `npm run test:compose` | Build final, migrations 001/002, bootstrap, login, prontidão e persistência após recriação aprovados. |

Durante o desenvolvimento, a execução sem permissão de IPC do `tsx` falhou com EPERM e foi repetida com a permissão necessária. Ao incorporar os testes diagnósticos à suíte permanente, foram corrigidos o ambiente jsdom e as tipagens de teste. O primeiro navegador também detectou uma expectativa antiga de botão habilitado após cadastro: foi substituída por verificações de sucesso, matrícula persistida única e bloqueio do mesmo reenvio. Somente as execuções finais aprovadas fundamentam este encerramento. Um aviso transitório de proxy durante o startup não impediu a execução final do navegador.

## Critérios relacionados e limites

- A03/A05–A10: regressões de contexto de convite e confirmação das verificações de autoridade existentes; SMTP e recuperação não são declarados completos.
- A18–A24 e A28/A31 nos recortes E1: integridade de turma, período de matrícula, elegibilidade, modo e edição versionada; chamadas reais continuam fora desta entrega.
- A79/A80: decisão temporal no servidor e fuso persistido; A82/A83: feedback, foco e retry por teclado, com axe. Avaliação humana com leitor de tela continua pendente.
- R26 e recortes operacionais A87/A92: prontidão, instalação e persistência. Health valida o manifesto, não toda alteração manual de DDL fora das migrations. Campanha completa de manutenção/backup/restauração não foi antecipada.

Não houve mudança de schema, dependências, `.env` ou banco da instalação. Os testes descartaram somente seus containers, volumes e dados sintéticos, sem backup. A skill de frontend orientou feedback acessível e preservação da identidade visual existente. Git continua não reconhecendo este diretório como repositório; não foi possível usar `git diff --check`, nem houve reparo ou commit.

## Uso após a correção

Em desenvolvimento, reinicie a API se necessário e recarregue a página. Não há migration nova para esta correção: a instalação deve ter 001 e 002 aplicadas. Se estiverem faltando, siga o procedimento documentado de migração; em instalação existente, backup anterior continua obrigatório. Em produção, reconstrua e recrie frontend/backend conforme o [guia](../instalacao-e0.md), preservando o volume PostgreSQL.

E0/E1 estão revalidadas em seus escopos. A próxima entrega continua sendo **E2 — Primeiro marco demonstrável**, somente quando solicitada. Permanecem os limites planejados de piloto, carga, acessibilidade humana e distribuição pública; testes verdes não garantem ausência de outros defeitos.
