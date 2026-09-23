# Especificação do MVP — Ping Presença

Versão documental: 1.0 · 10/09/2026 · Estado: requisitos consolidados; E0 e E1 concluídas em seus escopos, com execução acompanhada nos registros da [E0](entregas/e0.md) e da [E1](entregas/e1.md). E2 ainda não iniciada.

**Atualização de execução:** as pendências da [revisão posterior de E0/E1](entregas/revisao-e0-e1.md) foram [corrigidas e revalidadas](entregas/correcoes-e0-e1.md). Os requisitos deste documento não foram alterados por essa revisão ou pelas correções.

## 1. Objetivo e limites

Software aberto de chamada para instituições de ensino, cursinhos, professores independentes e mentorias. O professor abre uma chamada da aula, projeta um QR code e um código digitável rotativos, e o aluno autenticado confirma presença pelo navegador. A instalação pode exigir geolocalização como validação adicional.

Uma confirmação vale pela aula inteira no MVP. Atraso, saída antecipada e outras exceções são tratados por correções manuais justificadas e auditadas. O desenho deve permitir checkpoints futuros, mas não implementá-los agora.

QR/código e geolocalização dificultam presença remota, mas não garantem presença física: um código pode ser compartilhado e a localização do dispositivo pode ser falsificada. Essa limitação faz parte da apresentação do produto e da avaliação do piloto. O sistema deverá funcionar por Wi-Fi e 4G/5G, sem exigir a rede da instituição.

Stack acordada: React com TypeScript e Zustand no frontend; Node.js com TypeScript no backend; PostgreSQL. Framework HTTP, ORM, ferramentas de testes e organização interna permanecem decisões técnicas.

## 2. Vocabulário e modelo conceitual

Os nomes abaixo descrevem conceitos; não impõem nomes de tabelas, endpoints ou enums.

| Conceito | Responsabilidade |
| --- | --- |
| Instalação/instituição | Uma organização por instalação, com configurações, usuários e banco próprios. |
| Conta | Identidade de acesso, estado ativo/inativo, e-mail, verificação e papéis acumuláveis. |
| Disciplina | Conteúdo acadêmico reutilizável, como Programação I. |
| Turma/oferta | Ocorrência de uma disciplina em um período, com professores, matrículas, turno e horários. |
| Período de matrícula | Intervalo de participação de um aluno em uma turma; pode haver vários intervalos sem sobreposição. |
| Aula | Ocorrência planejada com início, fim, turma, local e modo `PILOT` ou `OFFICIAL`. |
| Sessão de chamada | Chamada lógica da aula. Reaberturas mantêm a mesma sessão. |
| Abertura | Intervalo específico em que a sessão aceita o fluxo automático, com prazo próprio e snapshot de regras. |
| Autorização curta | Permissão temporária, vinculada a aluno, sessão e abertura, para concluir uma tentativa. Não é presença. |
| Tentativa | Resultado de uma submissão: aceita, pendente ou rejeitada, com motivo e dados auditáveis disponíveis. |
| Registro de frequência | Estado atual único do aluno na aula, com origem e versão para concorrência. |
| Consolidação manual | Rascunho e conclusão excepcional de chamada realizada completamente fora do sistema. |
| Exclusão do cálculo | Decisão administrativa que desconsidera uma ausência no percentual, sem convertê-la em presença. |
| Evento de auditoria | Evidência de ação aplicada, autor/origem, instante, motivo e mudanças pertinentes. |

Uma aula possui uma única chamada lógica no MVP. Várias aberturas não são várias chamadas nem checkpoints. Tentativas históricas e estado atual do registro são conceitos distintos.

## 3. Requisitos acordados

### R01 — Instalação e papéis

- Uma instituição por instalação, com um único `OWNER` no MVP. Multi-tenancy fica fora da primeira versão.
- Uma conta pode acumular papéis, por exemplo owner e professor. A autorização deve considerar todos os privilégios efetivos da conta.
- Somente o owner concede ou remove `ADMIN` e inicia recuperação assistida de contas administrativas.
- Administradores comuns não podem criar, substituir ou alterar o owner, promover/remover administradores ou recuperar contas administrativas.
- A administração controla disciplinas, turmas, atribuição de professores, matrículas, locais e configurações gerais.
- Professores não criam disciplinas, turmas ou matrículas e não se vinculam sozinhos às turmas.
- Professores vinculados criam/editam aulas, operam chamadas e corrigem presenças somente em suas turmas.
- A operação cotidiana da chamada pertence aos professores vinculados. Administração pode intervir excepcionalmente, sem precisar assumir vínculo de professor; intervenções sobre presença exigem justificativa e identificação administrativa na auditoria.
- Alunos consultam apenas os próprios registros e participam somente de aulas para as quais são elegíveis.
- Todas as permissões são verificadas no backend, inclusive em acesso direto a recursos e em operações concorrentes.

### R02 — Bootstrap do owner

- A criação inicial exige um segredo forte configurado pelo operador da instalação, por exemplo em variável de ambiente.
- O backend verifica a existência do owner. Depois de uma criação bem-sucedida, o mecanismo de bootstrap fica desativado, inclusive sob requisições simultâneas.
- O segredo não é armazenado no banco como credencial reutilizável e não serve para login, recuperação ou elevação de privilégios.
- A documentação orienta sua remoção ou rotação após o bootstrap.
- A recuperação de acesso não reabre o bootstrap nem cria um segundo owner.

### R03 — Contas e convites

- Não existe cadastro público livre depois do bootstrap.
- São aceitos e-mails válidos de qualquer provedor. Identificador institucional é separado, opcional ou obrigatório conforme configuração administrativa.
- Administração cadastra ou importa usuários e define antecipadamente seus papéis e vínculos. O owner mantém a exclusividade de atribuir privilégios administrativos.
- Convites podem ser enviados por e-mail, se houver SMTP, ou entregues como link individual por outro canal. SMTP não é obrigatório para utilizar a instalação.
- O convite expira, tem uso único, pertence à conta criada e é invalidado ao ser usado ou substituído por um novo convite.
- Aceitar convite permite definir senha e concluir o cadastro, sem escolher papéis ou associações acadêmicas.
- O canal de entrega é registrado. Aceitar um convite destinado e entregue por e-mail pode verificar esse endereço; gerar/enviar o e-mail sem aceitação não o verifica.
- Convites entregues manualmente não preenchem `emailVerifiedAt`.
- A recuperação por e-mail não pode tratar endereço não verificado como identidade previamente comprovada.

### R04 — Recuperação de acesso

| Conta alvo | Recuperação assistida autorizada |
| --- | --- |
| Aluno/professor sem privilégios administrativos | Administrador, após verificação de identidade pelo procedimento da instituição. |
| `ADMIN`, inclusive se também for professor | Somente owner. |
| `OWNER` | Exclusivamente comando de manutenção na infraestrutura, inclusive se houver e-mail verificado. |

- Recuperações assistidas exigem justificativa e auditoria de início: responsável ou origem, conta alvo, instante e motivo.
- O link é temporário, de uso único e exclusivo da conta. Serve somente para escolher uma nova senha; não altera e-mail, papel, matrícula ou outros dados.
- Quem inicia não define nem conhece a nova senha.
- A conclusão revoga todas as sessões e os links de recuperação restantes, consome o link utilizado e é auditada. Os dados e o histórico da conta são preservados.
- Recuperação não equivale a verificação do e-mail.
- O comando do owner localiza o owner existente, exige justificativa, gera apenas o link e registra a origem como manutenção de infraestrutura. Não depende do segredo inicial nem cria/promove usuários.
- Recuperação ordinária por endereço previamente verificado deve respeitar essas restrições, especialmente a exclusividade do procedimento do owner. Seus detalhes técnicos serão definidos no desenho de autenticação.

### R05 — Desativação de contas

- Desativar impede login e novas ações, revoga sessões e invalida convites, links de recuperação e o uso de autorizações curtas existentes.
- Papéis, vínculos e histórico são preservados. A ação não encerra matrículas automaticamente.
- Matrícula vigente de aluno desativado continua sendo considerada para a aula; sem registro/exceção aplicável, o aluno pode receber falta.
- Antes de desativar, a interface informa as matrículas vigentes e essa consequência. Retirada acadêmica exige encerrar os períodos de matrícula separadamente.
- As restrições de gestão de contas administrativas e do owner não podem ser contornadas pela desativação de contas.

### R06 — Disciplinas, turmas e arquivamento

- Uma disciplina pode ter várias turmas simultâneas ou em períodos diferentes.
- Turma comporta período letivo, turno, um ou mais professores, matrículas, horários recorrentes, status ativo/inativo e modo padrão de presença.
- Administração controla criação e vínculos. Professores atuam apenas nas turmas atribuídas.
- Apenas administração inativa/reativa turma. A inativação só é permitida sem chamada aberta.
- Turma inativa bloqueia novas matrículas, novas aulas, abertura/reabertura de chamadas e nova atividade acadêmica.
- Inativar não encerra matrículas, cancela aulas ou modifica registros históricos.
- Consultas e correções históricas autorizadas continuam disponíveis para professores vinculados e administração, com auditoria quando aplicável.
- Reativar libera novas operações, sem reabrir matrículas encerradas ou restaurar aulas canceladas.
- Ambas as ações registram autor e instante; justificativa é desejável, mas opcional no acordo atual.
- Turmas inativas permanecem nas áreas de histórico/administração, separáveis das ativas no uso cotidiano.

### R07 — Matrícula temporal e rematrícula

Uma matrícula cobre a aula somente quando:

```text
enrolledAt <= início planejado da aula
e (endedAt é vazio ou endedAt > início planejado da aula)
```

- A referência é sempre o início planejado, nunca a abertura, fechamento ou reabertura da chamada.
- Entrar depois do início não inclui o aluno naquela aula. Sair durante a aula não elimina sua participação nela.
- Remover aluno encerra o período, sem apagar o vínculo nem os registros anteriores. Correções de aulas cobertas continuam possíveis.
- Retorno à mesma turma cria novo período; não reutiliza nem reabre o período antigo.
- Períodos do mesmo aluno na mesma turma não se sobrepõem. Aulas no intervalo entre períodos não pertencem à sua participação.
- Histórico de frequência é único por aluno/turma, reunindo seus períodos, com separação entre piloto e oficial. Administração/auditoria visualizam os períodos.
- Alterações retroativas de `enrolledAt`/`endedAt` e novas matrículas retroativas são bloqueadas quando mudariam a participação em aulas cuja chamada já foi aberta.
- Exceções por falha administrativa são tratadas por exclusão de ausência do cálculo, não por falsificação da matrícula ou da presença.

### R08 — Planejamento e identidade da aula

- Gerar antecipadamente aulas individuais a partir do período e dos horários recorrentes, e permitir aulas avulsas para reposições, cursinhos ou mentorias.
- Cada ocorrência gerada é independente e pode ser editada/cancelada individualmente dentro das restrições abaixo. Gerar não abre chamadas.
- Aula futura sem chamada, registros ou outro histórico associado pode ser excluída. Com histórico, deve ser preservada e eventualmente cancelada.
- Após a primeira abertura, turma, data, horário inicial e horário final ficam bloqueados. Corrigir esses campos exige cancelar e criar outra aula.
- Título, descrição e observações permanecem editáveis se não mudarem as regras de presença.
- Local pode mudar após a primeira abertura somente com chamada fechada, justificativa e auditoria. A reabertura produz novo snapshot.
- Cada aula guarda `attendanceMode`: `PILOT` ou `OFFICIAL`. O modo da turma é o padrão para novas aulas.
- O modo da aula fica imutável após a primeira abertura **ou o início do rascunho de consolidação manual**.
- Mudar o padrão da turma pode afetar apenas aulas futuras sem processo de presença iniciado. Aulas de piloto nunca viram oficiais retroativamente.

### R09 — Locais, política e snapshot

- Administração cadastra locais autorizados com identificação, latitude, longitude, raio permitido e obrigatoriedade de geolocalização no local/contexto.
- Professor escolhe entre locais a que tem acesso; não altera coordenadas, raio nem desliga uma exigência administrativa.
- Antes da primeira abertura, pode trocar o local da aula dentro desses limites.
- Depois da abertura, mudanças em local ou configuração que afete validação exigem fechamento, justificativa, auditoria e nova abertura para produzir efeito.
- Cada abertura guarda um snapshot do local e das regras, incluindo raio e critérios de precisão. Tentativas ficam vinculadas a ele.
- Editar o cadastro original não muda resultados passados nem silenciosamente a política de uma abertura em andamento.
- Geolocalização é política adicional. Quando não exigida, QR/código vigente e as demais regras continuam obrigatórios.

### R10 — Sessão, abertura, encerramento e reabertura

- Uma confirmação vale por toda a aula; há uma única sessão lógica de chamada por aula no MVP.
- Abrir/reabrir exige turma ativa, aula não cancelada, permissão e estar no intervalo planejado da aula.
- Cada abertura tem duração própria. A instituição define padrão, ajustável pelo professor.
- Prazo efetivo: o menor entre o prazo solicitado e o fim planejado da aula. No instante do fim não há nova confirmação automática.
- Fechamento manual ou automático impede emissão/aceitação de códigos e invalida autorizações curtas daquela abertura.
- Expiração é aplicada pelo backend mesmo se a rotina de consolidação estiver atrasada ou o cliente exibir informação antiga.
- Fechamento automático usa as mesmas regras do manual e tem o sistema identificado como autor na auditoria.
- Fechar marca ausência automática para cada aluno elegível sem presença confirmada, decisão manual aplicável ou pendência ativa. Pendências não viram faltas automaticamente.
- Reabrir exige justificativa e auditoria, mantém a mesma sessão, preserva registros e cria abertura com novo prazo, novos códigos e novo snapshot.
- Códigos antigos não voltam a valer; não se reaproveita tempo restante da abertura anterior.
- Ausência automática pode ser substituída por confirmação válida na reabertura. Decisão manual não é substituída pelo fluxo automático.
- Após o término da aula, são permitidas somente as operações manuais e análises históricas autorizadas; não há abertura/reabertura por QR/código.

### R11 — Fluxo do aluno e autorização curta

1. Aluno acessa o QR ou encontra a chamada de sua turma e informa o código digitável.
2. Deve estar autenticado antes da validação do código pelo backend. Se o código vencer durante o login, apresenta o atual.
3. Backend valida elegibilidade, chamada/abertura, prazo e código vigente antes de emitir autorização curta.
4. Autorização é vinculada ao aluno, sessão e abertura específica; expira no menor prazo entre sua duração própria e o fechamento/fim da aula.
5. A tela apresenta conta conectada, turma, aula, data/horário e aviso de localização quando exigida.
6. Somente ao acionar **Confirmar minha presença** a aplicação solicita localização obrigatória e conclui as validações restantes.
7. A interface mostra confirmação, pendência ou rejeição com motivo compreensível.

- Ler QR, digitar código ou receber autorização não gera presença nem pendência de localização. Abandonar a tela não gera registro acadêmico.
- Autorização não sobrevive a fechamento, reabertura ou desativação da conta. A autorização de outro aluno nunca é utilizável.
- Requisitos e permissões são reavaliados no backend ao concluir; receber autorização não reserva presença independentemente do estado posterior.
- Expiração durante o fluxo exige nova tentativa quando ainda possível; não produz presença retroativa.

### R12 — Decisão de geolocalização

Quando a política exige geolocalização, usar distância `d` em metros até o local, precisão informada `a` e raio `r` do snapshot:

| Condição | Resultado da validação geográfica |
| --- | --- |
| `d + a <= r` | Aprovada; presença somente se todas as demais regras forem satisfeitas. |
| `d - a > r` | Tentativa rejeitada por estar fora do raio. |
| Demais casos válidos, com incerteza cruzando o limite | Pendente por precisão insuficiente. |
| Permissão negada ou localização indisponível | Pendente por não ser possível validar localização. |

- Com `r = 100`: `(d=60, a=20)` aprova; `(140,20)` rejeita; `(90,30)` fica pendente.
- Pendência só decorre de fluxo autorizado e submetido; código inválido, falta de matrícula ou prazo vencido não podem ser contornados por falha de localização.
- Rejeição da tentativa não equivale a ausência consolidada da aula.
- A precisão é informada pelo dispositivo; a avaliação conservadora não elimina falsificação de localização.

### R13 — Tentativas, pendências e estado atual

- Preservar sequência cronológica das tentativas e seus motivos; não apagar rejeições ou pendências superadas.
- Enquanto aberta, permitir nova tentativa após rejeição automática ou pendência de localização. Cada nova tentativa exige código vigente e nova autorização; não reutiliza a anterior.
- Confirmação válida pode superar pendências ainda não analisadas e ausência automática, preservando a sequência anterior.
- Tentativa rejeitada posteriormente não apaga nem resolve pendência anterior. No fechamento, essa pendência impede ausência automática.
- Professor vê tentativas anteriores e posteriores para contextualizar sua decisão.
- Aprovar pendência leva a presença; rejeitá-la manualmente pode consolidar ausência. Essas decisões são explícitas, justificadas e auditadas.
- Decisão manual já aplicada é protegida contra novas tentativas automáticas, inclusive concorrentes.
- Pendências superadas por presença válida ou resolvidas por decisão deixam de ser pendências ativas; sua evidência histórica permanece.

### R14 — Lançamento e correção manual

- Professor vinculado pode registrar presença sem tentativa prévia, por exemplo por falta de celular, bateria ou conexão.
- Presença manual exige justificativa e auditoria e é distinguida de aprovação de pendência existente.
- Professores e administração podem corrigir registros após a aula, conforme suas permissões. Atraso e saída antecipada são tratados dessa forma no MVP.
- Intervenção administrativa não requer vínculo de professor, exige motivo e marcação explícita de origem administrativa.
- Registrar autor, instante, motivo, estado anterior e novo estado nas alterações de presença.
- Alterar um registro manualmente exige sua versão atual; conflitos não podem ser resolvidos por sobrescrita silenciosa.

### R15 — Consolidação inteiramente manual

- Fluxo excepcional para chamada feita completamente fora do sistema, como em papel durante indisponibilidade.
- Disponível somente se a chamada automática nunca foi aberta. Não cria uma via paralela para aulas que já tiveram qualquer abertura.
- Permite lançamento posterior ao fim da aula, sem emitir QR, código ou autorização curta.
- Professor prepara rascunho, informa presença/ausência para a lista completa elegível, revisa e confirma com justificativa obrigatória.
- Rascunho não entra na frequência. Conclusão dá estado consolidado de presença/ausência aos alunos elegíveis e inclui a aula no cálculo.
- O fluxo não gera tentativas geográficas artificiais ou pendências/rejeições de código. Histórico preexistente não é apagado.
- Auditoria distingue consolidação manual posterior, autor, instante, motivo e alterações posteriores.
- Se houve abertura automática, qualquer ajuste ocorre sobre seus registros existentes, pelos mecanismos normais de correção.

### R16 — Cancelamento

- Aula com histórico é preservada. Cancelamento exige justificativa e auditoria.
- Cancelar encerra eventual chamada aberta e invalida seus códigos e autorizações.
- Todas as presenças, ausências e pendências permanecem como histórico, mas não contribuem aos totais de frequência.
- Aula cancelada é identificada para professor e aluno; nunca gera faltas novas por fechamento/cancelamento.
- Reativar turma não desfaz cancelamento de aula.

### R17 — Ausência excluída do cálculo

- Somente administração pode excluir uma ausência do cálculo por exceção, por exemplo falha institucional que impediu participação.
- Não altera matrícula nem transforma ausência em presença. O registro continua ausente, com indicação de que foi desconsiderado.
- Exige justificativa, autor, instante e auditoria explícita.
- Pode abranger várias ausências de um aluno em uma turma/intervalo, com revisão dos alvos e auditoria por registro.
- Administração pode revogar a exclusão com nova justificativa. Os dois eventos permanecem, e a ausência volta a contar se a aula continuar elegível.
- Essa exclusão é independente do cancelamento da aula: afeta somente os registros selecionados.

### R18 — Frequência e modo da aula

Para cada aluno/turma/modo, considerar somente aulas não canceladas, cobertas pela matrícula e que tenham pelo menos um fechamento de chamada ou consolidação manual concluída:

```text
frequência = presenças / (presenças + ausências incluídas) × 100
```

- Cada aula tem peso igual; não calcular por minutos ou carga horária no MVP.
- Ausências excluídas administrativamente e pendências não entram no denominador. Exibir pendências e exclusões separadamente.
- Sem presença nem ausência incluída, mostrar **frequência ainda não calculada**, nunca `0%` por ausência de dados.
- Primeira abertura ainda não fechada não participa do percentual.
- Após primeiro fechamento, a aula permanece no cálculo durante reabertura; o resultado é provisório enquanto ela estiver reaberta.
- Pendência ativa relevante mantém o percentual provisório. Ao resolver, recalcular; fechamento posterior não remove a provisoriedade se ainda houver pendência.
- Aula nunca aberta e sem consolidação manual concluída não participa. Rascunho manual não participa.
- Calcular e apresentar frequências `PILOT` e `OFFICIAL` separadamente. Sair do piloto não incorpora seu histórico ao oficial.
- Correções e revogações de exclusão recalculam o resultado pertinente. Rejeição isolada de tentativa não entra como falta.

### R19 — Integridade e concorrência

- Um único estado atual de frequência por aluno/aula, com múltiplas tentativas/eventos históricos possíveis.
- Reenvios e concorrência não duplicam presença nem aplicação de decisões.
- Fechamento/expiração e confirmações concorrentes não permitem confirmação automática após o limite válido.
- Decisões manuais não são sobrescritas pelo automático.
- Alterações manuais exigem versão atual ou mecanismo equivalente no backend. Versão antiga resulta em conflito, sem aplicar decisão nem criar auditoria falsa de alteração concluída.
- Interface apresenta estado atualizado e exige nova ação consciente e justificativa para eventual correção.
- Controle vale também entre professores e administradores. Privilégio maior não autoriza sobrescrita silenciosa de uma versão antiga.
- Estado e auditoria correspondente devem permanecer consistentes: falha de persistência não pode deixar alteração efetiva sem sua evidência obrigatória.

### R20 — Projeção e acompanhamento

- Projeção separada do painel de gestão, com acesso fácil a tela cheia e atualização automática do QR/código.
- Mostrar somente disciplina/turma, aula, QR vigente, código digitável, tempo até rotação, prazo restante e indicação de chamada aberta.
- Não mostrar nomes, presenças individuais, ausências, pendências, justificativas ou dados de localização.
- Fechamento/expiração remove os códigos e mostra chamada encerrada. Perda de sincronização suspende a apresentação como válida e informa o problema.
- Painel do professor em outra aba, janela ou dispositivo acompanha confirmações em tempo real e oferece as ações autorizadas.
- A separação de telas não substitui configurar corretamente o compartilhamento/projeção do equipamento.

### R21 — Histórico do aluno

- Acesso exclusivo aos próprios registros, inclusive de turmas/períodos cuja matrícula já terminou.
- Mostrar data da aula, estado atual, modo piloto/oficial e motivos compreensíveis quando houver pendência ou rejeição.
- Exemplos: localização não pôde ser validada; posição fora do raio permitido; localização com precisão insuficiente.
- Não expor coordenadas nem detalhes internos da política ao aluno.
- Refletir correções posteriores, cancelamentos e exclusões administrativas pertinentes.
- Não implementar contestação/pedido de revisão dentro do sistema no MVP. O contato ocorre pelo canal habitual; a correção é auditada.

### R22 — Auditoria

- Preservar a sequência de tentativas e ações; correções acrescentam histórico em vez de reescrevê-lo silenciosamente.
- Distinguir, no mínimo: abertura/reabertura/fechamento; fechamento automático; presença manual; decisão de pendência; correção; intervenção administrativa; consolidação manual; cancelamento; troca de local/política; exclusão/revogação de ausência; arquivamento/reativação; recuperações de acesso.
- Usar autor autenticado e função exercida, ou origem explícita de sistema/manutenção. Não atribuir ação automática ao professor.
- Registrar instante do backend, alvo, justificativa quando exigida e valores anteriores/novos relevantes.
- Permissões e mecanismos de acesso não podem permitir alteração silenciosa da auditoria pela interface/API.
- Integridade histórica não implica retenção ilimitada de todo dado pessoal. A evolução do ciclo de vida deve preservar os registros que precisem permanecer, com referência mínima e política explícita.

### R23 — Privacidade e ciclo de vida

- Latitude/longitude do aluno existem apenas durante a validação; não persistir em banco, histórico, logs de requisição/erro ou ferramentas de monitoramento.
- Preservar resultado, motivo, distância calculada quando disponível, `accuracy` quando disponível, instante e vínculo com o snapshot.
- Indisponibilidade de localização não inventa distância/precisão; usar ausência de valor e motivo pertinente.
- Distância registrada é o valor auditável; não será possível recalculá-la a partir de coordenadas descartadas.
- Coordenadas do **local autorizado** fazem parte do cadastro/snapshot e são distintas das coordenadas descartadas do aluno.
- Mudanças futuras no local/raio não reinterpretam tentativas antigas.
- Arquitetura deve prever políticas futuras de retenção, exportação, anonimização ou exclusão por necessidade da instituição, evitando dependência de retenção pessoal indefinida.
- Não implementar por implicação um apagamento indiscriminado ou definir prazos legais universais. Política concreta, escopo de exportação e execução desses procedimentos serão decididos conforme o contexto da instituição.
- Segredos, senhas, tokens brutos e configurações privadas não devem aparecer em auditoria, logs comuns ou repositório.

### R24 — Fuso e autoridade temporal

- Instalação configura um fuso, como `America/Sao_Paulo`.
- Horários planejados e recorrências são interpretados no fuso da instalação e convertidos a instantes inequívocos para validação/persistência.
- Backend é a fonte de verdade para início/fim, matrícula, abertura, expiração, códigos, autorizações, fechamento automático e auditoria.
- Mudar relógio/fuso do dispositivo não altera elegibilidade, prazos ou datas auditadas.
- Contagens regressivas no cliente são apresentação; validação efetiva ocorre no servidor.
- Início de matrícula é inclusivo; fim é exclusivo. Prazo da chamada e término da aula não aceitam confirmação no instante do vencimento nem depois dele.
- Evolução da configuração de fuso não pode deslocar silenciosamente instantes históricos já fixados.

### R25 — Acessibilidade

- Funções principais devem funcionar por teclado e tecnologias assistivas.
- Controles têm identificação compreensível, foco perceptível e mensagens acessíveis; estados não dependem exclusivamente de cor.
- QR nunca é o único caminho: código digitável permanece disponível.
- Login, convites, confirmação, resultados, gestão de pendências e correções fazem parte da validação acessível.
- Temporizadores e atualizações automáticas não devem tornar o conteúdo inutilizável, roubar foco ou impedir compreender o resultado.
- Critérios detalhados estão no documento de aceitação; conformidade normativa não deve ser declarada sem avaliação correspondente.

### R26 — Instalação, manutenção e atualização

- Docker Compose é caminho oficial de referência com frontend, backend e PostgreSQL, mas não dependência arquitetural.
- Documentar bootstrap, domínio, HTTPS por proxy reverso, SMTP/opção manual de convites, persistência do PostgreSQL, backup, restauração, atualização/migrações e desenvolvimento sem Docker.
- Fornecer `.env.example` documentado; segredos e configurações institucionais ficam fora do versionamento.
- Identificar versões de origem/destino e migrações. Não exigir atualização sem interrupção ou versões simultâneas no MVP.
- Manutenção começa bloqueando novas aberturas/reaberturas; chamadas existentes podem concluir confirmações e fechar normalmente.
- Depois de terminarem, bloquear novas escritas e aguardar operações já iniciadas antes de realizar backup.
- **Backup anterior à migração é obrigatório no procedimento oficial.** Não prosseguir sem backup concluído.
- Registrar versão atual, aplicar nova versão, executar migrações, verificar funcionamento e só então liberar acesso.
- Falha mantém serviço protegido; restaurar backup e versão anterior antes de liberar quando necessário.
- Suspender todas as escritas abrange fluxos de alunos, professores, administração e tarefas internas que alterem dados; a conclusão das chamadas ocorre antes dessa fase.

### R27 — Capacidade e desempenho

- Alvo inicial: 10.000 usuários cadastrados, 5.000 alunos ativos, 100 chamadas simultâneas, turmas normalmente com 30–80 alunos e rajadas de milhares de tentativas em poucos minutos.
- Referência de teste: uma máquina com 4 vCPUs, 8 GB RAM e SSD, executando Node.js e PostgreSQL.
- Testar até 100 tentativas completas por segundo por cinco minutos, além de cargas intermediárias de 50/s e cenários concorrentes.
- Metas: pelo menos 95% das respostas em até 1 s, 99% em até 3 s, menos de 1% de erros internos/inesperados/indisponibilidade.
- Excluir do tempo medido a interação de login e obtenção de localização; medir o backend e a persistência. Rejeições de negócio são separadas de falhas do serviço.
- Medir throughput, latência, erros, CPU, memória e comportamento do PostgreSQL.
- Nenhuma duplicação de presença, confirmação automática após o limite ou sobrescrita automática de decisão manual é aceitável.
- Metas e hardware não são garantia prévia, requisito mínimo definitivo nem limite funcional do produto.
- Cache distribuído, filas e escalabilidade horizontal entram apenas quando evidência justificar; instalações maiores podem separar serviços.

### R28 — Licença e colaboração

- Licença escolhida: `AGPL-3.0-only`, não autorização automática a versões futuras.
- Uso comercial é permitido sob os termos da licença. A intenção é preservar abertura das versões modificadas, incluindo oferta pela rede.
- Documentar a disponibilização do código-fonte correspondente aos usuários abrangidos, especialmente em versões modificadas oferecidas como serviço. Não implica obrigação de enviar pull request ao repositório original.
- Dependências mantêm suas licenças e exigem avaliação de compatibilidade/avisos antes de distribuição.
- Documentação explicativa não substitui o texto da licença. Referências: [AGPL-3.0-only no SPDX](https://spdx.org/licenses/AGPL-3.0-only.html) e [FAQ GNU](https://www.gnu.org/licenses/gpl-faq.html).
- Este planejamento não instala uma licença no repositório nem constitui auditoria de dependências ainda não escolhidas.

### R29 — Demonstração, piloto e versão pública

- Demonstração individual opcional por volta de 22/09/2026: fluxo estável de configuração, turma/aula, chamada, aluno em outro dispositivo/sessão, geolocalização, pendência, fechamento, auditoria e histórico.
- Demonstração não comprova funcionamento em sala. Simulação deve ser identificada como tal.
- Piloto real ocorre em paralelo ao método habitual do professor, que continua referência oficial; divergências não afetam frequência oficial.
- Medir confirmação de presentes, bloqueios/pendências, confirmações consideradas indevidas, precisão interna, uso de QR/código, duração comparativa da chamada, intervenções e dificuldades relatadas.
- Identificar claramente aulas/registros de piloto. Comparações devem ser possíveis sem misturá-los ao cálculo oficial.
- Adoção oficial depende da avaliação da instituição após validar condições reais e corrigir problemas relevantes.
- Sem deadline obrigatório. Entregas menores não retiram requisitos do MVP público completo.

## 4. Fora do escopo funcional inicial

- Várias instituições na mesma instalação.
- Vários checkpoints por aula e frequência ponderada por tempo.
- Contestação/revisão pelo aluno dentro do sistema.
- Retroatividade de matrícula que reescreva participação em chamada já iniciada.
- Cadastro público livre, criação de turmas/matrículas pelo professor e promoção de administradores por administradores comuns.
- Atualização sem interrupção, migrações online complexas e compatibilidade simultânea entre versões.
- Recursos distribuídos sem evidência de necessidade.
- Política universal de retenção e rotinas completas de anonimização/exclusão/exportação ainda não definidas; a preparação arquitetural para elas está dentro do MVP.

Integrações com sistemas acadêmicos, autenticação institucional, aplicativos nativos e políticas adicionais de comprovação não foram requisitos acordados. Não devem ser incluídos automaticamente nas entregas.
