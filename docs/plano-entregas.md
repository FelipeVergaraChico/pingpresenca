# Sequência de entregas — Ping Presença

Versão documental: 1.0 · 10/09/2026.

Referências: [especificação](especificacao-mvp.md), [aceitação](criterios-aceitacao.md) e [propostas técnicas](decisoes-tecnicas.md).

## Estratégia

Desenvolvimento liderado pelo mantenedor nas horas livres, com auxílio do Codex e possível colaboração de um amigo. A sequência abaixo é uma proposta de execução, não estimativa de datas nem divisão obrigatória de equipe.

Cada marco integra interface, backend, persistência e validação das regras que apresenta. A auditoria e o controle de acesso entram junto com a operação correspondente. Funcionalidade ausente em um marco intermediário continua pendente no MVP completo.

**22/09/2026** é apenas uma oportunidade opcional de demonstração individual. Se o fluxo não estiver adequado, a apresentação é adiada. Não se apresenta uma demonstração individual como validação de sala real nem como versão pública completa.

## Visão das entregas

| Marco | Resultado utilizável | Dependência |
| --- | --- | --- |
| E0 — Base executável | Subir uma instalação local, configurar fuso e criar owner protegido. | Desenho técnico mínimo. |
| E1 — Preparar uma aula | Administração cria acessos, local, disciplina, turma, matrícula e aula avulsa. | E0. |
| E2 — Chamada ponta a ponta | Professor projeta, aluno confirma, professor resolve pendência/fecha e aluno consulta histórico. | E1. |
| E3 — Integridade operacional | Reabertura, concorrência, indisponibilidade e limites temporais validados para experimentar em sala. | E2. |
| E4 — Piloto observado | Experimento real em paralelo à chamada habitual, com resultados registrados. | E3 + disponibilidade de professor/turma. |
| E5 — Gestão e exceções completas | Recorrência, importação, ciclo acadêmico, recuperação de acesso e exceções do MVP. | E3; pode evoluir enquanto se agenda E4. |
| E6 — Distribuição pública | Instalação, migração/restauração, desempenho e documentação comprovados. | E5 + avaliações e correções pertinentes. |

Os marcos não autorizam criar funcionalidades ainda não acordadas. O primeiro piloto depende de oportunidade externa; isso não impede avançar nas entregas locais.

## E0 — Base executável e decisões mínimas

**Estado:** concluída em 10/09/2026 no escopo deste marco. Consulte [implementação, testes e cobertura parcial dos critérios transversais](entregas/e0.md).

### Entregar

- Definir framework/backend, acesso ao PostgreSQL, migrations e testes, registrando escolhas curtas e suas razões.
- Estrutura de frontend/backend compatível com execução separada; React/TypeScript/Zustand e Node/TypeScript/PostgreSQL.
- Configuração validada, fuso da instalação e tratamento de instantes do backend.
- Primeira migration e bootstrap único do owner com segredo de instalação e teste concorrente.
- Estrutura de autenticação, autorização, auditoria e separação de dados pessoais adequada às próximas entregas.
- Execução local reproduzível, Compose inicial, `.env.example` sem segredos e identificação inicial de licença.

### Aceitar quando

- Ambiente limpo sobe conforme instruções locais e persiste seus dados.
- Bootstrap não pode ser repetido ou disputado para criar dois owners.
- O frontend não é autoridade para permissões ou tempo.
- Evidência inicial para A01–A02, A79–A81 e partes aplicáveis de A87/A92.

## E1 — Preparar uma aula real

**Estado após correções de 10/09/2026:** concluída e revalidada no escopo E1. Os sete achados da [revisão E0/E1](entregas/revisao-e0-e1.md) foram [corrigidos e testados](entregas/correcoes-e0-e1.md). Versão `0.2.0-e1`. Consulte [implementação e evidências anteriores](entregas/e1.md) e [decisões técnicas adotadas](adr/0002-preparacao-academica.md). A cobertura parcial não conclui requisitos de marcos posteriores.

Inclui a correção posterior de mensagens por campo, identificada pelo mantenedor após a validação inicial. A lacuna e os testes de regressão estão registrados no relatório da E1; não foram adiados para E2.

### Entregar

- Gestão administrativa individual de contas e papéis dentro da hierarquia acordada.
- Convite manual completo e autenticação; canal de convite/verificação modelado para o SMTP, sem marcar e-mail manual como verificado.
- Cadastro de disciplina, turma/oferta, professores vinculados, períodos de matrícula e local autorizado.
- Aula avulsa com início/fim, local e modo de presença; modo piloto claramente identificado.
- Interfaces utilizáveis por teclado, validação e mensagens compreensíveis desde os formulários iniciais.
- Testes de elegibilidade pelo início planejado, acesso entre turmas e snapshot de regras.

### Aceitar quando

- Owner/admin prepara professor e aluno por interfaces reais e convida sem exigir SMTP.
- Professor não ganha acesso a turma por manipular identificadores.
- A aula possui contexto temporal e acadêmico inequívoco.
- Evidências para A03–A10 conforme fluxos entregues, A18–A20, A28 e A31.

## E2 — Primeiro marco demonstrável

**Revalidação em 23/09/2026:** REV-E2-01 a REV-E2-04 corrigidos, incluindo preservação do rascunho da política. Sem nova pendência de código identificada na verificação. Aceite integral continua pendente do roteiro humano com leitor de tela. Consulte [evidências atuais](entregas/fechamento-tecnico-e2.md). E3 não foi iniciada.

**Revisão em 23/09/2026:** os três achados funcionais da revisão foram [corrigidos e revalidados](entregas/correcoes-e2.md). A verificação humana com leitor de tela continua pendente; E3 não foi iniciada.

**Estado em 22/09/2026:** implementação `0.3.0-e2` disponível e testes automatizados executados. Aceitação integral ainda pendente da verificação humana com leitor de tela; não marcar esse item como atendido por axe/DOM. Consulte [evidências, roteiro e limites](entregas/e2.md) e [ADR 0003](adr/0003-chamada-e2.md). E3 não foi iniciada.

### Entregar

- Abertura com duração limitada ao fim da aula, rotação de QR/código e projeção sem dados individuais.
- Autorização curta e confirmação explícita do aluno, com geolocalização real quando exigida.
- Resultados aceito/pendente/rejeitado, histórico de tentativas e proteção das decisões manuais já exercitadas.
- Painel do professor atualizado, análise de pendência e presença manual individual justificadas.
- Fechamento manual/automático, consolidação de ausência, auditoria e histórico próprio do aluno.
- Frequência básica correta, separada por modo, com pendências e ausência de dados tratadas corretamente.
- Tratamento visível de expiração, perda de conexão e falha de localização. Coordenadas de aluno fora da persistência e dos logs.

### Aceitar quando

- O mantenedor consegue configurar a instância, preparar aula, abrir projeção, entrar como aluno em outra sessão/dispositivo, confirmar, resolver pendência, fechar e consultar histórico.
- Falta automática e presença manual são distinguíveis na auditoria.
- Nenhuma presença nasce apenas da leitura do QR ou da emissão de autorização.
- Telas acessíveis do fluxo principal passam por verificação por teclado e leitor de tela.
- Exercitar A32–A35, A38–A55 conforme operações disponíveis, A63–A69 pertinentes e A71–A86.

### Roteiro da apresentação

1. Mostrar instalação identificada como piloto e contas sintéticas do professor e aluno.
2. Preparar local/turma e aula avulsa dentro do horário de demonstração.
3. Abrir a chamada e a projeção; mostrar conta/turma/aula na confirmação do aluno.
4. Usar QR ou código em outro dispositivo, obter localização e confirmar.
5. Mostrar uma pendência reproduzível, por exemplo negando localização em outra conta de demonstração, e decidir com justificativa.
6. Fechar, mostrar ausência consolidada de aluno sem registro e consultar a auditoria/histórico.
7. Explicar o que foi realmente exercitado e o que depende do piloto real.

Preparação de dados é identificada como demonstração, não como atalho oculto para alterar presença. Exemplos sintéticos não podem entrar em uma turma oficial real.

## E3 — Preparação técnica para o piloto

**Iniciada em 23/09/2026 por solicitação do mantenedor.** O teste humano com leitor de tela da E2 foi explicitamente adiado, não dispensado nem aprovado. Lembrete único agendado para 30/09/2026 às 9h (America/Sao_Paulo). A pendência deve ser retomada antes de declarar acessibilidade validada para o piloto.

**Implementação técnica E3 entregue em 23/09/2026 (`0.4.0-e3`).** Reabertura, cancelamento, recuperação assistida/CLI, conflitos, testes de indisponibilidade, carga sintética e restauração disponíveis. Veja [resultados e ressalvas](entregas/e3.md) e [operação](operacao-piloto.md). Aceite de prontidão para uma turma real depende do teste assistivo e da validação do ambiente/turma selecionados. E4/E5 não iniciadas. As notas anteriores de “E3 não iniciada” na seção E2 são registros históricos anteriores a esta autorização.

Ordem interna: (1) reabertura, mudança de local e cancelamento; (2) recuperação assistida e CLI do owner; (3) concorrência, indisponibilidade e interface; (4) ensaio de backup/restauração, carga preliminar e relatório. Não iniciar E4/E5 automaticamente.

### Entregar

- Reabertura completa, prazos independentes, invalidação de códigos/autorizações antigos e preservação das decisões manuais.
- Concorrência entre confirmação, fechamento e decisões de vários docentes/admins; conflito por versão antiga na interface.
- Recuperação após indisponibilidade: expiração continua sendo imposta e consolidação não duplica efeitos.
- Cancelamento auditado e retirada correta dos cálculos.
- Fluxos mínimos de recuperação de acesso necessários aos participantes do piloto; owner recuperável pelo mecanismo restrito de infraestrutura.
- HTTPS no ambiente acessado pelos dispositivos, procedimento de backup/restauração exercitado e identificação permanente de piloto.
- Verificações de exposição de dados, acessibilidade e carga preliminar suficiente ao tamanho da turma selecionada.

### Aceitar quando

- Limites de horário, estado e permissões resistem a reenvios e requisições concorrentes.
- Pendência/rejeição não se transforma silenciosamente em presença ou falta.
- Não há falha conhecida de integridade no fluxo usado pelo piloto.
- Cobrir A11–A15 nos caminhos utilizados, A27–A28, A33–A37, A43, A48–A55, A59, A67, A70, A75–A86 e A88.

## E4 — Piloto em paralelo

### Executar

- Professor mantém a chamada habitual como referência oficial; turma/aulas do experimento ficam em `PILOT`.
- Comparar presença observada com resultados do sistema e registrar divergências sem alterar frequência oficial.
- Medir leitura no projetor, código manual, permissão/precisão em ambientes internos, Wi-Fi/4G e uso simultâneo em celulares reais.
- Comparar tempo da chamada e contar intervenções manuais; coletar dificuldades de professor e alunos.
- Usar dados derivados e motivos para diagnóstico, respeitando a não persistência de coordenadas exatas.

### Produzir

- Relato do ambiente, tamanho da turma, versão/política usada, quantidade e tipos de divergência, tempos e problemas encontrados.
- Lista priorizada de correções com reprodução quando possível.
- Separação entre problema de interface, operação, geolocalização, conectividade e regra de negócio.

### Critério de avanço

Corrigir problemas relevantes observados antes de recomendar uso oficial. A entrevista não fixou percentuais máximos de pendência ou um número obrigatório de aulas de piloto; esses critérios serão definidos com o professor a partir do contexto real. Se E4 ainda não tiver ocorrido, qualquer versão experimental deverá informar que não houve validação em sala.

## E5 — Completar a gestão e as exceções do MVP

### Entregar

- Geração antecipada por recorrência, edição individual e aulas avulsas; importação administrativa de usuários com convites e vínculos.
- Matrícula temporal completa, rematrícula, bloqueio de retroatividade e histórico unificado por turma.
- Desativação de conta, arquivamento/reativação de turma e avisos das consequências.
- SMTP opcional, verificação correta por canal, recuperação assistida de aluno/professor e admin, além do comando de owner.
- Consolidação inteiramente manual com rascunho/revisão/conclusão para aulas nunca abertas.
- Exclusão/revogação administrativa de ausência do cálculo, individual e por intervalo com revisão dos alvos.
- Todos os cálculos, cancelamentos, mudanças de modo/local e correções coerentes com o histórico.
- Revisão da arquitetura para retenção/exportação/anonimização futuras, sem introduzir rotina de apagamento não definida.

### Aceitar quando

- Requisitos R01–R25 estão cobertos nos cenários aplicáveis.
- Nenhuma funcionalidade permite burlar proteção de papéis, matrícula, decisões manuais ou auditoria.
- Pontos de interação listados no documento técnico foram resolvidos antes das respectivas implementações.
- A01–A86 possuem evidência apropriada, além de A95 quando houver piloto realizado.

## E6 — Preparar a versão pública reproduzível

### Entregar

- Documentação final de instalação Compose, execução sem Docker, domínio/HTTPS, variáveis, SMTP e convite manual.
- Persistência, backup e restauração exercitados em ambiente limpo.
- Manutenção em duas etapas; atualização identificável com backup obrigatório antes da migração, verificações e retorno à versão anterior em caso de falha.
- Campanha de carga de referência, relatório de resultados e limites observados, sem promessas de capacidade não medida.
- Licença AGPL-3.0-only e avisos consistentes, inventário de dependências/licenças e instruções para contribuições/distribuição de versões modificadas.
- Revisão final de permissões, exposição de dados e acessibilidade, documentação das limitações de geolocalização e do modo piloto.

### Aceitar quando

- A87–A95 têm evidências, além da cobertura funcional anterior.
- O procedimento oficial falha de forma explícita se o backup obrigatório não for concluído; recuperação é demonstrada, não apenas descrita.
- Metas de carga foram medidas e o resultado está publicado. Reprovação gera correção ou revisão explícita do alvo, nunca declaração implícita de aprovação.
- Limitações do piloto e da comprovação de presença física permanecem transparentes.

## Política de mudanças durante a execução

- Atualizar especificação e cenário de aceitação juntos quando uma decisão de produto mudar.
- Dividir cada marco em tarefas pequenas com resultado visível, pré-condições e evidência de conclusão.
- Não implementar várias camadas isoladamente por longos períodos: integrar a funcionalidade do marco e verificá-la antes de avançar.
- Bibliotecas e parâmetros podem mudar com justificativa técnica; regras acadêmicas não mudam por conveniência da implementação.
- Recursos adiados da demonstração permanecem no plano. Funcionalidades futuras explicitamente fora do MVP não são adicionadas como dependências artificiais do marco inicial.
