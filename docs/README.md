# Ping Presença — planejamento do MVP

Consolidação da entrevista de produto realizada em setembro de 2026. Data desta versão: **10/09/2026**.

Este conjunto descreve o produto acordado, seus critérios de aceitação e uma sequência de implementação. A existência de um requisito não comprova sua implementação; o estado e os testes de cada entrega são registrados separadamente.

**Estado em 22/09/2026:** E0/E1 permanecem verificadas em seus escopos. E2 implementada para demonstração, com testes automatizados e aceitação humana com leitor de tela ainda pendente. Consulte [evidências E2](entregas/e2.md), [ADR 0003](adr/0003-chamada-e2.md), [evidências E0](entregas/e0.md), [E1](entregas/e1.md) e [guia de instalação](instalacao-e0.md). E3 e o MVP completo não estão concluídos.

**Atualização da revisão:** os sete achados da [revisão E0/E1](entregas/revisao-e0-e1.md) foram [corrigidos e revalidados](entregas/correcoes-e0-e1.md). E0/E1 estão concluídas nos seus escopos; as limitações e entregas posteriores permanecem no plano.

**Estado atual — 23/09/2026:** E3 implementada e verificada tecnicamente; consulte [evidências e limitações E3](entregas/e3.md), [ADR 0004](adr/0004-integridade-piloto.md) e [recuperação/backup/operação](operacao-piloto.md). O leitor de tela humano continua pendente por adiamento explícito, com lembrete em 30/09 às 9h. Piloto real E4 não iniciado; as notas acima preservam os estados anteriores.

| Documento | Finalidade |
| --- | --- |
| [Especificação do MVP](especificacao-mvp.md) | Requisitos funcionais e transversais, permissões, conceitos e invariantes. |
| [Critérios de aceitação](criterios-aceitacao.md) | Cenários verificáveis, referenciados pelos identificadores dos requisitos. |
| [Sequência de entregas](plano-entregas.md) | Marcos utilizáveis, dependências e condições para demonstração, piloto e versão pública. |
| [Decisões técnicas propostas](decisoes-tecnicas.md) | Arquitetura candidata, parâmetros iniciais e pontos a resolver durante o desenho técnico. |

## Como interpretar

Visualização adicional autorizada em 30/09/2026: [calendário opcional de aulas](entregas/calendario-aulas.md), com contagem mensal limitada no backend e detalhes paginados por dia.

Melhoria adicional solicitada em 30/09/2026: [abas, lista compacta e paginação das aulas](entregas/paginacao-aulas.md). O documento registra também a revisão futura das demais listas acumulativas, sem declarar E4/E5 implementadas.

- **Requisitos acordados:** os itens `R01` a `R29` da especificação consolidam as decisões da entrevista. Mudanças nesses requisitos devem ser explícitas e refletidas nos critérios de aceitação.
- **Critérios de aceitação:** descrevem o que deverá ser comprovado; a presença de um cenário no documento não significa que exista teste ou implementação.
- **Propostas técnicas:** escolhas de biblioteca, módulos, intervalos e mecanismos internos permanecem revisáveis. O documento técnico não substitui as regras de negócio.
- **Pontos em aberto:** interações ainda não decididas estão identificadas no documento técnico. Não devem ser tratadas como funcionalidades aprovadas por implicação.

O marco opcional de apresentação em **22/09/2026** não é um prazo obrigatório. O desenvolvimento será liderado pelo mantenedor, com auxílio de ferramentas e possível colaboração de um amigo, nas horas disponíveis. A qualidade e a consistência dos registros orientam as entregas.

A instalação de referência atenderá uma instituição por instalação. A licença escolhida é **AGPL-3.0-only**. Os requisitos completos continuam no MVP mesmo quando não fazem parte da primeira demonstração.
