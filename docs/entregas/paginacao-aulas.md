# Organização e paginação das aulas

Melhoria solicitada pelo mantenedor em 30/09/2026, após E3. Não inicia E4/E5 nem inclui calendário ou geração recorrente.

Atualização posterior: o mantenedor autorizou separadamente o [calendário opcional](calendario-aulas.md), que reutiliza estes filtros e detalhes sem remover a paginação.

## Comportamento

- Docentes/admins: abas **Próximas aulas** e **Histórico de aulas**. Contas com participação como aluno também têm **Minha frequência**.
- Alunos: **Próximas aulas** e **Minha frequência**, sem repetir duas listas históricas.
- Próximas inclui aulas em andamento e futuras (`ends_at > statement_timestamp()`); histórico inclui aquelas cujo término planejado já passou (`ends_at <= statement_timestamp()`). A classificação vem do banco, nunca do relógio do dispositivo. Chamada fechada antecipadamente continua em próximas até o fim da aula; aula passada nunca aberta continua acessível no histórico.
- Próximas em ordem crescente de início; histórico em ordem decrescente. O ID desempata horários iguais.
- Lista compacta, descrição expansível, modo e estado escritos por extenso, mantendo acesso à chamada, edição e prévia de elegibilidade.
- Filtros combináveis por datas de início da aula (dias inclusivos no fuso da instalação), modo e situação da chamada. Em Minha frequência, situação significa o registro próprio: presença, ausência, pendência ou sem registro.
- Ao aplicar/limpar filtros, voltar à primeira página. Trocar turma/aba reinicia os filtros. Rascunho de edição não depende da página exibida; alterações concorrentes continuam exigindo revisão explícita.
- Minha frequência pagina aulas passadas, mas seu resumo continua abrangendo **toda a turma**, separado por modo e obedecendo às regras de inclusão existentes. Uma aula ainda em andamento pode contribuir após seu primeiro fechamento; seu registro é acessado em Próximas aulas. Filtros/páginas não recalculam um percentual parcial.

## Contrato de API e decisão técnica

`GET /api/offerings/:id/lessons` responde `{items, pagination}` em vez de array ilimitado.

`GET /api/attendance/history/:id` preserva `{lessons, frequency}` e acrescenta `pagination`.

Parâmetros comuns:

| Parâmetro | Regra |
| --- | --- |
| `page` | Inteiro de 1 a 1.000.000; padrão 1. Página além do resultado é ajustada à última. |
| `pageSize` | Inteiro de 1 a 50; padrão 10. Interface usa 10. |
| `scope` | `all` (padrão da API), `upcoming` ou `past`. Interface escolhe explicitamente. |
| `from`, `to` | Datas ISO válidas; início deve ser anterior ou igual ao fim. |
| `mode` | `PILOT` ou `OFFICIAL`, opcional. |
| `status` | `NOT_OPENED`, `OPEN`, `CLOSED`, `CANCELLED`, `PRESENT`, `ABSENT`, `PENDING` ou `NONE`, opcional. |

`pagination` contém `page`, `pages` (mínimo 1), `pageSize` e `total`. Conjunto vazio retorna página 1, total 0 e lista vazia. Entradas inválidas geram 400 com explicação, sem refletir valores arbitrários. Não existe opção de buscar tudo sem limite.

A consulta usa `LIMIT/OFFSET` no PostgreSQL, com ordenação determinística. Contagem, página e agregação de frequência usam uma única instrução e o mesmo snapshot. Frequência é agregada no banco, não sobre os itens da página nem sobre todos os registros transferidos para Node. Permissões e vigência da matrícula são aplicadas antes da contagem/paginação, inclusive rematrículas.

O índice existente `lessons_offering_start` é reutilizado; nenhuma migration nova. Paginação por offset é suficiente para este recorte e permite páginas numeradas. Não equivale a uma garantia de custo constante: contagem e frequência globais ainda examinam o conjunto elegível. Se medições de instalações maiores indicarem necessidade, avaliar índices adicionais e cursor. Inserções/alterações entre requisições podem deslocar páginas; não há snapshot histórico congelado entre cliques.

## Verificação

- `LIST-01` em `backend/test/e2.integration.test.ts`: páginas reais no PostgreSQL, limites/entradas inválidas, desempate, filtros combinados, fuso e fronteira de data, rematrícula, escopo de acesso e frequência global independente de filtros/página. Relacionado a A23, A63, A69, A73 e A80.
- `LIST-02` a `LIST-05` em `frontend/src/academic/LessonList.test.tsx`: requisições paginadas, reset dos filtros, erro compreensível, resposta antiga descartada, teclado das abas e resumo global. Relacionado a A73/A82/A83.
- `LIST-06` no fluxo real `e2e/bootstrap.spec.ts`: turma com várias páginas, filtros, abas por teclado, axe e apresentação desktop/celular.
- `LIST-07` em `frontend/src/academic/ReviewRegressions.test.tsx`: a troca de página preserva a aula em edição e o rascunho não salvo.
- Teste humano com leitor de tela continua pendente; axe/DOM não o substitui.

Resultados executados em 30/09/2026:

- `npm run test --registry=https://registry.npmmirror.com`: 17 testes backend e 49 frontend aprovados. Um teste anterior de foco passou a aguardar o efeito do React antes de verificar o foco, preservando a mesma exigência.
- `npm run test:integration --registry=https://registry.npmmirror.com`: E0 (10), E1 (10), E2 (10), E3 (8) e regressões backend (9) aprovados — 47 cenários, sem contar testes-pai. PostgreSQL Docker isolado; dados da instalação não foram usados.
- `npm run typecheck --registry=https://registry.npmmirror.com` e `npm run build --registry=https://registry.npmmirror.com`: aprovados.
- `PLAYWRIGHT_CHANNEL=chrome npm run test:browser --registry=https://registry.npmmirror.com`: 4 testes aprovados (fluxo real E0–E3 ampliado e 3 regressões de projeção). Axe sem violações nos pontos verificados; screenshots de lista desktop/celular inspecionados. A barra de filtros também possui asserção de altura para evitar regressão ao layout vertical excessivo.

Ambiente local Node 24.18.0, PostgreSQL 16 descartável e Chrome; a referência oficial Node 22/Compose não foi recertificada nesta melhoria. Não houve migration nova nem nova campanha de capacidade E6.

## Próxima revisão de paginação (pendente)

Solicitação registrada: **listas que acumulam dados devem nascer paginadas no backend**, com limite padrão/máximo, autorização antes da contagem, ordenação estável, filtros validados e resumos independentes da página. Não carregar todos os registros para paginar em React.

Revisar separadamente: contas, turmas, matrículas, catálogos crescentes, tentativas, auditoria e registros do painel da chamada. Seletores devem evoluir para busca paginada quando necessário — truncar silenciosamente um select não é aceitável. Painéis ao vivo exigem contrato que preserve totais e atualizações, não apenas aplicar `LIMIT` aos arrays existentes. Essas mudanças **não** estão incluídas nesta entrega e nenhuma lista é declarada paginada por antecipação.
