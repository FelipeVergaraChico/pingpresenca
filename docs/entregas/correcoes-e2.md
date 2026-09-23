# Correções da revisão E2 — 23/09/2026

Os achados REV-E2-01, REV-E2-02 e REV-E2-03 da [revisão](revisao-e2.md) foram corrigidos e revalidados. A E3 não foi iniciada. A aceitação integral da E2 continua pendente do roteiro humano com leitor de tela.

## Alterações

- **REV-E2-01:** painel de gestão e participação própria deixam de ser alternativas mutuamente exclusivas. Contas STUDENT elegíveis, inclusive com privilégios de gestão, acessam confirmação automática e seus próprios registros/tentativas. A lista de elegíveis continua sendo fornecida pelo backend; os endpoints mantêm todas as verificações de autorização. A API de turmas também informa `can_view_history`, calculado por papel e existência de matrícula, independentemente de `can_manage`. Matrículas encerradas continuam permitindo histórico.
- **REV-E2-02:** ausência automática admite decisão explícita de ausência via `CORRECTION`, com justificativa, versão e auditoria existentes. Escolher presença nesse caso continua usando o fluxo distinto `MANUAL`. Não é criada presença intermediária artificial.
- **REV-E2-03:** callbacks de salvamento e atualização após conflito ficam vinculados à geração da seleção. Trocar aluno ou cancelar/iniciar análise invalida os callbacks anteriores para essa seleção, preservando novos rascunhos. A proteção de versão no backend permanece intacta.
- **Banco descartável:** os helpers de integração, navegador e regressão aguardam `pg_isready` em TCP (`127.0.0.1`), evitando aceitar a prontidão do socket Unix do servidor temporário de inicialização. Isso não altera a configuração da instalação nem seu banco real.

Arquivos principais: `frontend/src/attendance/AttendancePage.tsx`, `frontend/src/academic/OfferingPanel.tsx`, `frontend/src/academic/types.ts`, `backend/src/academic/routes.ts`, `scripts/{integration,browser-server}.mjs` e `backend/test/review-regressions.test.mjs`.

Os diagnósticos da revisão foram promovidos para `frontend/src/attendance/ReviewRegressions.test.tsx`, incluídos automaticamente em `npm test`. O comando de diagnóstico com `reviews/e2/vitest.config.ts` continua apontando para esses testes permanentes. A integração adicional está em `backend/test/e2.integration.test.ts`.

## Evidência desta correção

Todos os comandos npm utilizaram `--registry=https://registry.npmmirror.com`.

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | Backend e frontend aprovados. |
| `npm test` | 17 testes backend e 33 frontend aprovados, incluindo 8 controles/regressões desta revisão. |
| `npm run build` | Backend e frontend aprovados. |
| `npm run test:integration` | Comando completo aprovado: 10 cenários E0, 10 E1, 9 E2 e 9 regressões backend; contadores Node incluem testes-pai. |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:browser` | Fluxo integrado aprovado, incluindo confirmação, pendência, fechamento, histórico e 13 verificações axe. |

A primeira execução unitária encontrou `listen EPERM` no socket local do runner `tsx`, bloqueado pelo sandbox. A repetição com permissão para executar o runner passou; não houve alteração de código para contornar esse bloqueio. O build e os testes locais usam Node 24; Node 22 continua sendo a referência oficial. Compose não foi reexecutado nesta correção; sua evidência anterior permanece no relatório de revisão, sem ser apresentada como nova execução.

O teste de integração novo verifica ADMIN+STUDENT com/sem matrícula para histórico, confirmação automática com papéis acumulados e persistência de ausência como correção manual auditada. Os testes DOM verificam formulário disponível, negativa sem elegibilidade, payload correto, preservação do rascunho durante resposta atrasada e atualização de conflito que não troca outro aluno selecionado. Relaciona-se a R01/R11/R14/R19/R21 e aos recortes A41–A42, A51–A53 e A73; não conclui integralmente critérios de marcos posteriores.

Nenhuma migration nova, alteração de `.env` ou operação sobre banco real foi necessária. Os recursos sintéticos das suítes foram removidos pelos próprios runners. Git continua não reconhecendo esta cópia como repositório; não foi recriado histórico Git.

## Pendências

- Verificação humana com leitor de tela permanece necessária para aceite integral da E2.
- GPS físico, câmera/projetor e uso simultâneo em sala continuam sujeitos ao piloto.
- Próximo marco do plano: E3 — Preparação técnica para o piloto, mediante solicitação do mantenedor.
