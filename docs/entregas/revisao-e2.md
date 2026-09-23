# Revisão da E2 — 23/09/2026

**Atualização posterior:** os três achados foram corrigidos e os diagnósticos promovidos a regressões permanentes. Consulte [correções e novas execuções](correcoes-e2.md). O conteúdo abaixo preserva a evidência original da revisão, anterior às correções.

## Parecer

**A E2 ainda tem pendências; não declarar aceitação integral.** O fluxo principal passou novamente nas suítes existentes, mas três defeitos de interface foram reproduzidos em testes adicionais. A validação humana com leitor de tela continua pendente.

Revisão baseada na especificação, critérios de aceitação, plano de entregas, decisões técnicas e ADR 0003. Inspeção de rotas, serviço, domínio, migration, worker, projeção, confirmação, análise e histórico. Nenhuma regra foi flexibilizada e nenhuma funcionalidade da E3 foi implementada. Este trabalho acrescenta apenas relatório e testes diagnósticos, sem corrigir a aplicação.

## Achados reproduzidos

### REV-E2-01 — P2: privilégios de gestão escondem o fluxo de aluno

- Referências: R01, R11, R21; recortes A41–A42 e A73.
- Código: `frontend/src/attendance/AttendancePage.tsx:54`; `frontend/src/academic/OfferingPanel.tsx:393`.
- Uma conta com ADMIN e STUDENT, matriculada na turma, recebe `manages=true`. A tela escolhe exclusivamente o painel de gestão e não renderiza `StudentFlow`. O histórico próprio também depende de `!offering.can_manage`.
- Reprodução: entrar com esses papéis e abrir aula elegível em andamento. Não existe ação de validar código/QR como aluno, embora a API permita o fluxo para STUDENT elegível. O teste DOM reproduz a ausência do formulário; a restrição do histórico foi confirmada por inspeção.
- Esperado: preservar as duas capacidades, distinguindo atuação administrativa de participação como aluno; jamais substituir confirmação própria por presença manual administrativa.
- Correção proposta: separar capacidade de gestão da elegibilidade pessoal, com alternância ou seção própria. Testar também professor que acumula papel de aluno.

### REV-E2-02 — P2: ausência automática não pode receber decisão explícita de ausência na interface

- Referência: R14, distinção entre ausência automática e decisão manual.
- Código: `frontend/src/attendance/AttendancePage.tsx:167` e `:186`.
- Após fechamento, selecionar aluno com `ABSENT/AUTO_CLOSE`. O único resultado oferecido é Presença; a operação é forçada para `MANUAL`.
- Esperado: permitir manter o resultado Ausente como decisão manual justificada/auditada. A API já admite `CORRECTION` sobre registro existente. Não é correto exigir uma presença artificial intermediária para depois corrigi-la para ausência.
- Impacto atual: impossibilidade de registrar essa decisão pelo painel. A proteção contra substituição automática terá impacto adicional na reabertura da E3, ainda não implementada; esta revisão não afirma que reabertura já ocorre.
- Correção proposta: distinguir lançamento de presença manual de correção de ausência automática e enviar tipo de operação compatível com o resultado escolhido.

### REV-E2-03 — P2: resposta atrasada de uma análise descarta o rascunho de outra

- Referências: painel utilizável da E2, R19; complemento de interface à cobertura A52–A53.
- Código: `frontend/src/attendance/AttendancePage.tsx:176`.
- Reprodução determinística: enviar decisão de Ana, manter a resposta pendente, selecionar Bia, escrever justificativa, concluir a resposta de Ana. O callback executa `setSelected(null)` e desmonta a análise de Bia, perdendo o rascunho.
- Não foi observada gravação no aluno errado: o defeito demonstrado é perda de trabalho na interface, não violação da versão no backend.
- Correção proposta: vincular callbacks à seleção/operação de origem ou impedir troca durante a escrita. Aplicar a mesma proteção à atualização assíncrona após conflito, que também altera a seleção.

## Testes executados nesta revisão

Comandos npm executados com `--registry=https://registry.npmmirror.com`. Bancos de integração, navegador e Compose são sintéticos e descartáveis. Nenhum teste usou o banco da instalação, alterou `.env` ou migrou dados reais.

| Verificação | Resultado observado |
| --- | --- |
| `npm run typecheck` | Backend e frontend aprovados. |
| `npm test` | 17 testes backend e 25 frontend aprovados. |
| `npm run build` | Backend e frontend aprovados. |
| `npm run test:integration` | 10 cenários E0, 10 E1 e 8 E2 aprovados; comando completo falhou na suíte de regressão subsequente, descrita abaixo. |
| `node --test backend/test/review-regressions.test.mjs` (reexecução isolada) | 9 cenários aprovados, além do teste-pai; 63 negativas de autorização verificadas. |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:browser` | 1 fluxo integrado E0/E1/E2 aprovado, com 13 verificações axe. |
| `NPM_REGISTRY=https://registry.npmmirror.com npm run test:compose` | Build/runtime Node 22, migrations, bootstrap/login e persistência após recriação aprovados. |
| `./node_modules/.bin/vitest run --config reviews/e2/vitest.config.ts` | 2 controles aprovados e 3 testes falharam, reproduzindo os achados acima. |

Os testes adicionais ficam em `reviews/e2/attendance-review.test.tsx`, com configuração própria. Expressam o comportamento esperado, portanto **continuam vermelhos até a correção**; não integram silenciosamente a suíte normal nem tornam a revisão aprovada. Os controles verificam o formulário no modo aluno e a opção Ausência para uma pendência.

### Instabilidade observada na preparação do PostgreSQL de teste

A primeira execução da regressão esperava `SCHEMA_NOT_READY`, mas recebeu `DATABASE_UNAVAILABLE`; houve também `Connection terminated unexpectedly`. A reexecução independente passou integralmente. Não foi comprovado defeito de readiness da aplicação.

Hipótese sustentada pela inspeção: o helper em `backend/test/review-regressions.test.mjs:23` aguarda `pg_isready` pelo socket Unix, que pode responder durante o servidor temporário de inicialização do container, antes da instância TCP definitiva. O helper de `scripts/integration.mjs` utiliza padrão semelhante. Recomenda-se aguardar conexão SQL pelo mesmo endpoint TCP utilizado pelos testes. A causa permanece hipótese, não conclusão baseada em logs do container já removido.

## Cobertura e limites

- A32–A35: abertura, limite temporal, fechamento e consolidação exercitados no recorte disponível.
- A38–A51: autenticação, elegibilidade, autorização, confirmação explícita, geolocalização, tentativas e proteção manual exercitadas. O achado REV-E2-01 impede declarar a interface universalmente atendida para papéis acumulados.
- A52–A54: conflito de versão e rollback de auditoria exercitados no backend. REV-E2-03 acrescenta lacuna de estado da interface, não detectada pela suíte anterior.
- A55: apenas recorte já implementado; concorrência completa com fechamento, locks, expiração e carga não foi comprovada nesta revisão e permanece na E3/E6.
- A63–A69: fórmula básica, modos separados, pendências e primeira abertura; não inclui efeitos de reabertura, cancelamento ou exclusões ainda não entregues.
- A71–A78: projeção sem dados individuais, histórico próprio e persistência de derivados/snapshot revisados. Não equivale a certificar todos os proxies e ferramentas de observabilidade de uma instalação real.
- A79–A86: relógio/fuso, testes DOM, teclado e axe já automatizados reexecutados. **Não foi executado leitor de tela humano**, nem teste físico de GPS/câmera/projetor.

Não há evidência nesta revisão para afirmar ausência de todo defeito possível. Os testes de navegador emulam localização; o piloto físico permanece uma etapa distinta. Reabertura, cancelamento, recuperação de acesso e demais itens do plano não devem ser rotulados como esquecimentos da E2 quando pertencem explicitamente às entregas seguintes.

## Próximos passos

1. Corrigir REV-E2-01 a REV-E2-03 e transformar os diagnósticos em regressões permanentes.
2. Estabilizar a prontidão do banco descartável e repetir a suíte completa.
3. Executar e registrar o roteiro humano com leitor de tela descrito em `e2.md`.
4. Só então reavaliar aceitação da E2. Próximo marco previsto: **E3 — Preparação técnica para o piloto**, não iniciado nesta revisão.
