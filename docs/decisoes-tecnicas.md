# Decisões técnicas propostas — Ping Presença

Versão documental: 1.0 · 10/09/2026.

Este documento contém **propostas revisáveis**, não decisões de biblioteca já aprovadas, implementação existente ou desempenho comprovado. Os requisitos vinculantes estão na [especificação](especificacao-mvp.md).

As escolhas efetivamente adotadas na E0 estão na [ADR 0001 — Base executável](adr/0001-base-e0.md). Ela resolve os mecanismos da fundação sem transformar parâmetros de chamadas ou itens de marcos futuros em funcionalidades implementadas.

As decisões da E1, incluindo convites manuais, períodos sem sobreposição, escopo de acesso, prévia de política e o recorte E1 de D07, estão na [ADR 0002 — Preparação acadêmica](adr/0002-preparacao-academica.md). A [ADR 0003 — Chamada E2](adr/0003-chamada-e2.md) registra abertura, desafios, autorização, consolidação e a resolução de D02. SMTP, recorrência e reabertura permanecem nos marcos previstos.

## 1. Direção de arquitetura

### Proposta: backend modular único, PostgreSQL como persistência principal

Começar com um backend Node.js/TypeScript organizado em módulos, frontend React/TypeScript separado e PostgreSQL. O Compose coordena a instalação de referência; a aplicação recebe sua configuração por ambiente e não depende de nomes de containers para funcionar.

| Área candidata | Responsabilidade |
| --- | --- |
| Identidade e acesso | Bootstrap, contas, papéis, sessões, convites e recuperação. |
| Acadêmico | Disciplinas, ofertas, professores, matrículas temporais e planejamento de aulas. |
| Chamada | Sessão, aberturas, desafios rotativos, autorizações e expiração. |
| Frequência | Tentativas, estado atual, pendências, correções e consolidação manual. |
| Políticas e locais | Locais autorizados, regras e snapshots por abertura. |
| Auditoria e privacidade | Eventos, dados mínimos e preparação para ciclo de vida. |
| Operação | Configuração, manutenção, migrations, observabilidade e comandos restritos. |

Essas fronteiras não exigem serviços separados ou uma abstração para cada função. Casos de uso coordenam as operações com transações e verificações de permissão. Escolher framework HTTP e acesso ao banco no início de E0, com base em suporte adequado a validação, transações, migrações e testes.

Zustand pode cuidar do estado de interface, como filtros, seleção e passos locais. Estados oficiais de chamada, permissão, matrícula e frequência vêm do backend; cópia de cliente não autoriza operação nem decide prazo.

Não criar multi-tenancy, cache distribuído, fila externa ou infraestrutura de serviços para necessidades ainda não medidas. Centralizar configurações da instalação e evitar dependências de estado global espalhadas facilita evolução futura, mas não promete migração trivial para múltiplas instituições.

## 2. Estado acadêmico e histórico

### Proposta: separar quatro eixos

- **Tentativa:** resultado e motivo de uma submissão, com abertura/snapshot e evidência derivada.
- **Registro atual:** uma linha lógica por aluno/aula, estado consolidado, origem da decisão e versão.
- **Elegibilidade de cálculo:** modo da aula, cancelamento, consolidação e eventual exclusão administrativa da ausência.
- **Auditoria:** sequência das mudanças e suas relações com tentativas/decisões anteriores.

Isso evita tratar tentativa rejeitada como falta ou exclusão do cálculo como presença. A auditoria não precisa ser um sistema completo de event sourcing; a proposta é manter eventos coerentes com o estado corrente na mesma operação transacional.

Entidades candidatas: conta/papel, convite, sessão de acesso, recuperação, disciplina, oferta, vínculo de professor, período de matrícula, horário recorrente, aula, local/política, sessão de chamada, abertura/snapshot, autorização curta, tentativa, registro de frequência, consolidação manual, exclusão do cálculo e evento de auditoria.

Não transformar ausência de linha em falta: antes da consolidação, ausência de registro pode significar que o aluno ainda não tentou. A consulta precisa distinguir estado acadêmico não consolidado de ausência efetiva.

## 3. Concorrência, prazo e idempotência

- Restrições de banco devem impedir mais de um owner, duplicação de registro aluno/aula e sobreposição de períodos de matrícula; definir o mecanismo concreto na modelagem.
- Abertura, confirmação e fechamento devem ter uma ordem consistente para a mesma sessão. Decisões manuais verificam a versão corrente.
- Revalidar autorização, conta, abertura e prazo na operação que aplica o resultado, não apenas quando a requisição chega.
- O instante de aceitação é decidido pelo backend junto da transição persistida. Uma resposta entregue tarde não equivale a aceitar uma nova presença após o prazo; a mera chegada antecipada da requisição não reserva o direito de confirmar depois.
- Especificar e testar o ponto de decisão transacional antes de escolher locks/isolamento. Uma confirmação não pode ignorar um fechamento que já venceu a disputa ou um prazo já vencido.
- Fechamento repetido ou recuperação após reinício não deve duplicar faltas/eventos nem substituir decisões manuais. O prazo persistido bloqueia o fluxo mesmo antes de a consolidação terminar.
- Uma nova tentativa exige novo desafio vigente e nova autorização. Reenvio de transporte da **mesma submissão**, por exemplo após perda da resposta, deve ter tratamento idempotente: recuperar resultado já aplicado ou informar seu estado, sem aplicar novamente a presença.
- Consultar um resultado já aplicado, com autenticação apropriada, não reutiliza autorização antiga para produzir nova presença. Essa distinção deve aparecer nos testes.
- Revalidar privilégios atuais em recuperações pendentes: promover uma conta a admin não pode deixar ativo um link de recuperação administrativa comum que permita contornar a nova hierarquia.

## 4. Rotação e parâmetros candidatos

Os valores abaixo são ponto de partida para desenvolvimento e testes, não limites de produto acordados:

| Parâmetro | Proposta inicial | Validação necessária |
| --- | --- | --- |
| Código digitável | 6 dígitos, sempre dentro do contexto da chamada/abertura selecionada. | Tentativas por adivinhação, legibilidade, colisões de contexto e facilidade de digitação. |
| Rotação | 30 segundos. | Usabilidade com login já feito, câmera, digitação e recursos assistivos. |
| Autorização curta | Até 60 segundos, limitada pelo prazo da abertura e fim da aula. | Tempo real de confirmação e aquisição da localização. |
| Duração padrão da abertura | 10 minutos, configurável pela instituição e ajustável por abertura. | Expectativa do professor e limite do fim da aula. |
| Convite | Até 48 horas, configurável no desenho operacional. | Entrega manual/e-mail, invalidação e prazo razoável para primeiro acesso. |
| Recuperação de senha | Até 15 minutos. | Entrega, uso único e revogação de sessões. |

Não aceitar silenciosamente códigos de janelas vencidas para compensar lentidão: o mecanismo acordado para concluir o fluxo é a autorização curta emitida enquanto o código estava válido.

O código projetado é compartilhado pela turma e pode autorizar vários alunos elegíveis durante sua vigência. Não deve ser consumido globalmente pelo primeiro aluno. Uso único aplica-se às autorizações/submissões e links conforme seu propósito. QR e código são desafios de chamada, não uma implementação obrigatória do protocolo usado por aplicativos autenticadores.

Limitar adivinhação e abuso no backend. Calibrar limites por conta/chamada e sinais adicionais, evitando usar apenas IP como identidade de aluno: uma turma pode compartilhar saída de rede. Documentar e medir esses limites para que rejeições artificiais não mascarem o teste de carga.

## 5. Autenticação e canais de entrega

- Preferir sessões revogáveis no servidor. A escolha exata de cookie/token é técnica, mas precisa permitir revogação efetiva nas ações acordadas.
- Senhas devem ter armazenamento apropriado, sem recuperação do valor original. Links e autorizações devem ser imprevisíveis e ter representação de validação que não exponha o segredo reutilizável em logs/banco.
- Separar propósito, canal e conta alvo de convite e recuperação. Novo convite invalida o anterior; entrega manual não pode herdar a comprovação de um fluxo de e-mail.
- Nunca expor papel editável como mecanismo de aceite de convite.
- O comando de recuperação do owner tem saída controlada para o operador obter o link; o link não deve ser copiado para logs comuns, auditoria ou monitoramento. Auditoria registra a emissão, não o segredo.
- A identidade de quem possui acesso administrativo ao servidor pertence à operação da instalação. Registrar a origem de manutenção, sem fingir que houve autenticação web do owner.

## 6. Fuso, precisão temporal e reinícios

- Proposta: persistir instantes absolutos e fuso IANA da instalação; interpretar horários de recorrência no fuso configurado antes de gerar instantes individuais.
- Não usar horário enviado pelo navegador como autoridade para presença ou vigência. A precisão geográfica informada pelo dispositivo não muda essa regra temporal.
- Manter deadlines duráveis e recuperar o trabalho de fechamento após reinício. Uma rotina interna pode começar sem fila externa, desde que seja repetível e não controle sozinha a validade dos prazos.
- Definir comportamento explícito para horários locais ambíguos/inexistentes em fusos que tenham transições, em vez de ajustá-los silenciosamente.
- Mudanças no fuso da instalação devem preservar os instantes fixados e distinguir apresentação de replanejamento futuro.
- A documentação operacional deve incluir sincronização do relógio do servidor. A autoridade ser do backend não elimina a necessidade de um relógio de infraestrutura corretamente mantido.

## 7. Dados mínimos e evolução do ciclo de vida

Proposta de inventário para orientar a modelagem:

| Categoria | Tratamento inicial | Evolução a preservar |
| --- | --- | --- |
| Identidade pessoal | Dados necessários a conta, matrícula e contato, separados dos fatos de frequência. | Exportação, minimização e anonimização quando a política permitir. |
| Credenciais e links | Propósito e expiração explícitos; sem conteúdo bruto em eventos/logs. | Eliminação de material expirado sem remover evidência mínima da ação. |
| Coordenadas de aluno | Apenas memória durante validação, nunca persistidas. | Não depender delas para relatórios ou reprocessamento. |
| Distância/precisão e motivos | Associados à tentativa/snapshot; acesso restrito. | Retenção específica, evitando assumir que dados derivados deixaram de ser pessoais. |
| Local/política da abertura | Snapshot histórico coerente com a decisão original. | Cadastro atual pode mudar sem reescrever o snapshot. |
| Presença e decisões | Estado e cronologia com referência estável, sem copiar perfil pessoal completo em cada evento. | Preservar fatos acadêmicos necessários mesmo se atributos pessoais puderem ser reduzidos. |
| Logs e backups | Sem segredos/coordenadas; operação e acesso documentados. | Política futura deve abranger cópias e restaurações, não apenas o banco ativo. |

Não definir agora prazos universais de retenção ou afirmar que todo evento deve ser mantido para sempre. Separar o direito de corrigir presença da autoridade para executar eventual política de anonimização/exclusão. O MVP exige arquitetura preparada; política e interfaces completas ainda precisam de requisitos próprios.

## 8. Observabilidade e manutenção

- Métricas agregadas: latência, resultados, falhas, conexões e espera do banco, sem payloads sensíveis.
- Expor versões da aplicação/migrations em diagnóstico apropriado, sem segredos de configuração.
- Representar a manutenção como fases explícitas: impedir novas chamadas, escoar as existentes, bloquear novas escritas, aguardar as em processamento, backup, atualizar/verificar e liberar.
- Bloquear migração no procedimento oficial se o backup falhar. A existência de um arquivo de backup não substitui ensaiar restauração.
- Documentar comandos reproduzíveis de atualização e recuperação depois de existirem scripts reais; este planejamento não contém comandos fictícios para uma aplicação ainda não implementada.

## 9. Interações ainda em aberto

Estas questões não impedem a consolidação do plano. Devem ser resolvidas **antes da implementação da área afetada**; as sugestões não alteram silenciosamente os requisitos acordados.

| ID | Ponto a decidir | Proposta para a decisão técnica/produto | Marco |
| --- | --- | --- | --- |
| D01 | A entrevista bloqueou turma/data/horários e retroatividade de matrícula após abertura automática; na consolidação manual explicitou o bloqueio de modo já no rascunho. Falta definir os outros campos/lista nesse caminho. | Fixar contexto e lista elegível ao iniciar o rascunho e detectar alterações concorrentes; estabelecer como descartar/reiniciar rascunho sem reescrever histórico. | E5. |
| D02 | Várias tentativas podem ficar pendentes, mas existe um estado atual único por aluno/aula. | Adotado na ADR 0003: decisão sobre registro atual e todas as pendências apresentadas, sem revisão parcial. Novas tentativas que acrescentem contexto a uma pendência mudam a versão e exigem nova revisão. | Resolvida na E2. |
| D03 | Uma ausência automática excluída administrativamente pode receber confirmação em reabertura. A exclusão não é, por si, uma decisão manual de ausência. | Separar proteção do estado e exclusão do cálculo; definir se presença nova encerra aplicabilidade da exclusão, preservando seu evento. Não transformar a exclusão em bloqueio implícito de presença. | E5. |
| D04 | Regenerar horários, importar novamente ou alterar uma recorrência pode duplicar aulas/contas. | Definir chaves, prévia de mudanças e idempotência; não reescrever silenciosamente ocorrências independentes já geradas. Especificar formato inicial de importação e tratamento de erros. | E5. |
| D05 | Consolidação manual em turma arquivada e descarte de rascunho não foram detalhados. | Distinguir correção de histórico existente de início de nova atividade; não iniciar novo processo silenciosamente em turma inativa. | E5. |
| D06 | Reativação de conta, alteração/verificação de e-mail, proteção contra desativar o único owner e troca definitiva de titularidade não foram fechadas. | Modelar reativação sem restaurar links/sessões; preservar hierarquia nas alterações de conta. Transferência de owner precisa de requisito explícito antes de existir. | E5; proteção do único owner antes de oferecer sua gestão. |
| D07 | Mudanças de fuso, horários locais ambíguos e alterações de turma que afetem aulas futuras ainda não iniciadas precisam de UX concreta. | Exibir impacto e preservar instantes de aulas iniciadas; definir defaults previsíveis para geração futura. | E1/E5. |
| D08 | Exclusões em lote podem disputar com correções manuais individuais. | Validar versões da prévia e escolher aplicação atômica ou relatório de conflitos explícito; nunca aplicar em alvos alterados sem informar. | E5. |
| D09 | Latência de uma tentativa com duas etapas não é a mesma que latência de um único request. | [ADR 0004](adr/0004-integridade-piloto.md): métricas separadas por endpoint e fluxo completo, contagem explícita de projeção e reenvios. | Definida na E3; carga de referência completa na E6. |
| D10 | Critério quantitativo de sucesso do piloto não foi fixado. | Definir com o professor quantidade de aulas e tolerância operacional a pendências/intervenções; medir divergências e decidir antes de recomendar uso oficial. | E4. |

## 10. Registro de decisão por implementação

Para cada escolha relevante, registrar: problema concreto, requisito atendido, solução escolhida, alternativas consideradas, consequência operacional e teste que a valida. Evitar transformar preferências provisórias deste documento em compromissos irreversíveis sem evidência.
