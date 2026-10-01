# Critérios de aceitação — Ping Presença

Versão documental: 1.0 · 10/09/2026.

Referência: [especificação do MVP](especificacao-mvp.md). Os cenários são o catálogo de aceitação; execução e aprovação dependem de evidência na entrega correspondente. Em 10/09/2026, a [matriz da E0](entregas/e0.md) registra A01/A02 cobertos e os recortes transversais parciais; a [matriz da E1](entregas/e1.md) acrescenta evidências de gestão, convites manuais, preparação acadêmica e elegibilidade. Os recortes explicitamente parciais e os cenários ainda não exercitados continuam pendentes; concluir uma entrega não aprova integralmente todos os cenários nela referenciados. Dados e contas de teste precisam ser sintéticos.

## 1. Identidade e autorização

| ID | Requisitos | Cenário e resultado esperado |
| --- | --- | --- |
| A01 | R01, R02 | Em instalação sem owner, segredo incorreto não cria conta privilegiada. Segredo correto permite um único bootstrap. |
| A02 | R02, R19 | Duas solicitações simultâneas de bootstrap resultam em apenas um owner; a outra falha sem criação parcial. Depois disso, nem o segredo correto permite repetir a operação. |
| A03 | R01 | Professor não vinculado não consulta dados individuais nem opera a chamada de outra turma, inclusive por requisição direta. Professor não cria disciplina, turma ou matrícula nem se associa sozinho. |
| A04 | R01, R14, R22 | Intervenção administrativa em presença funciona sem vínculo de professor, exige justificativa e registra origem administrativa, autor, antes e depois. |
| A05 | R01, R04 | Admin não promove/remove outro admin, recupera conta administrativa ou modifica owner. Owner pode atribuir/remover admin e iniciar recuperação assistida de admin. Conta professor+admin não é tratada como conta comum. |
| A06 | R03 | Convite admite e-mail pessoal. Identificador institucional é independente; modo obrigatório impede cadastro sem identificador, modo opcional permite. |
| A07 | R03 | Aceite de convite mantém papéis e vínculos previamente atribuídos. Campos adulterados no cliente não concedem privilégios ou matrículas. Não existe cadastro público livre pós-bootstrap. |
| A08 | R03, R19 | Convite vencido, consumido ou substituído é recusado. Dois aceites concorrentes do mesmo link não produzem duas ativações válidas. |
| A09 | R03 | Sem SMTP, convite manual permite cadastro e mantém e-mail não verificado. Aceite de convite entregue por e-mail verifica apenas o endereço a que aquele fluxo pertence; envio isolado não verifica. |
| A10 | R03, R04 | Endereço não verificado não habilita recuperação automática que o trate como identidade comprovada. Um convite manual não pode ser apresentado como prova de recebimento por e-mail. |
| A11 | R04 | Recuperação administrativa de aluno/professor exige motivo e registra emissor, alvo e instante. Link permite só escolher senha, sem alterar e-mail, papéis ou vínculos. |
| A12 | R04 | Após concluir recuperação, sessões e demais links da conta deixam de funcionar; o link consumido não é reutilizado, histórico é preservado e e-mail continua com sua condição anterior de verificação. |
| A13 | R04 | Recuperação de admin por owner tem as mesmas garantias. Admin comum não obtém link para conta administrativa, mesmo se o alvo também for professor. |
| A14 | R02, R04 | Recuperação do owner, mesmo com e-mail verificado, ocorre somente pelo comando de infraestrutura. O comando não cria/promove usuário, não depende do segredo de bootstrap nem reabre sua rota. |
| A15 | R04, R22 | O comando exige motivo, gera link curto e de uso único e não recebe/exibe a nova senha. Auditoria distingue origem de manutenção de ação de um usuário web. |
| A16 | R05 | Desativar conta bloqueia login, sessões, convites, recuperações e conclusão de autorização curta já emitida; preserva os dados acadêmicos. |
| A17 | R05, R07 | Ao desativar aluno com matrícula vigente, interface avisa que ela permanece ativa. No fechamento de aula elegível, a desativação não o remove da lista nem impede falta automática quando aplicável. |

## 2. Estrutura acadêmica e vigência

| ID | Requisitos | Cenário e resultado esperado |
| --- | --- | --- |
| A18 | R06 | Uma disciplina possui duas ofertas com professores, horários e alunos diferentes; chamadas de uma não são acessíveis como se pertencessem à outra. |
| A19 | R07, R24 | Para aula às 19h, matrícula iniciada às 19h é elegível; iniciada depois não é. Matrícula encerrada exatamente às 19h não é elegível; encerrada às 19h01 é. |
| A20 | R07 | Abrir às 19h30, fechar e reabrir não muda a elegibilidade baseada no início planejado às 19h. |
| A21 | R07, R21 | Encerrar matrícula preserva registros anteriores e permite correção de aula coberta. Aluno ainda consulta esse histórico. |
| A22 | R07 | Rematrícula cria novo período e preserva o encerrado. Sobreposição é recusada, inclusive em gravações concorrentes; períodos adjacentes sem sobreposição são possíveis. |
| A23 | R07, R18 | Aula no intervalo entre duas matrículas não gera falta para o aluno. Histórico reúne os dois períodos sem duplicar a aula nem misturar piloto com oficial. |
| A24 | R07 | Alterar vigência ou inserir matrícula retroativa que mude participação em aula já aberta é recusado. Ajuste que não afete essas ocorrências respeita as demais regras normais. |
| A25 | R08, R24 | Horário recorrente gera ocorrências no período letivo e no fuso configurado. Cada aula pode ser alterada individualmente; gerar a série não abre chamadas. Aula avulsa independe da recorrência. |
| A26 | R08 | Aula futura sem histórico pode ser excluída. Aula com chamada/registros não é apagada pelo mesmo fluxo. |
| A27 | R08 | Após primeira abertura, tentar mudar turma, data, início ou fim falha no backend. Título/descrição sem efeito sobre presença continuam editáveis. |
| A28 | R08, R09 | Troca de local antes da abertura aceita somente local autorizado. Após abertura, exige fechamento, motivo e auditoria; nova abertura guarda novas regras e preserva o snapshot anterior. |
| A29 | R06 | Admin não inativa turma com chamada aberta. Sem chamada aberta, inativação bloqueia nova atividade, preserva histórico e permite consultas/correções autorizadas. |
| A30 | R06 | Reativação não reabre matrículas encerradas nem aulas canceladas. As duas operações registram autor e horário e aceitam justificativa opcional. |
| A31 | R08, R18, R29 | Modo fica bloqueado na primeira abertura ou início do rascunho manual. Mudança do padrão da turma não converte histórico de piloto em oficial nem altera aulas já iniciadas. |

## 3. Chamada, código e confirmação

| ID | Requisitos | Cenário e resultado esperado |
| --- | --- | --- |
| A32 | R10, R24 | Aula 19h–21h: abrir às 18h59 ou às 21h é recusado. Abrir às 20h50 por 20 min fixa encerramento às 21h. Reabrir obedece aos mesmos limites. |
| A33 | R10, R19 | Expiração bloqueia códigos e confirmações mesmo com consolidador atrasado ou backend reiniciado. A consolidação posterior não produz presenças retroativas nem faltas duplicadas. |
| A34 | R10, R22 | Fechamentos manual e automático produzem os mesmos estados para a mesma lista. No automático, auditoria identifica o sistema; no manual, o autor autenticado. |
| A35 | R10, R13 | Fechar marca falta automática somente para elegíveis sem presença ou pendência ativa, preservando decisões manuais. Aluno com pendência não recebe falta automática. |
| A36 | R10 | Reabrir exige justificativa, mantém ID da sessão, cria nova abertura e novo prazo. Códigos/autorizações anteriores continuam inválidos e registros existentes permanecem. |
| A37 | R10, R14 | Na reabertura, falta automática pode virar presença válida; falta manual não. Depois do fim planejado, nenhuma reabertura permite confirmação automática. |
| A38 | R11 | Aluno deslogado faz login depois de o código expirar: precisa informar/ler o atual. Backend não emite autorização curta antes de autenticar. |
| A39 | R01, R11 | Conta sem matrícula elegível ou acesso à turma não obtém autorização. Apresentar QR/código válido não contorna a autorização acadêmica. |
| A40 | R11 | Autorização de aluno A não funciona para B; autorização de outra abertura não funciona na atual. Expiração própria nunca ultrapassa a chamada ou o fim da aula. |
| A41 | R11 | Antes do clique explícito, tela identifica conta, turma, aula, data/horário e necessidade de localização. Ler QR, digitar código, cancelar ou abandonar não gera presença/pendência de localização. |
| A42 | R11, R25 | Código digitável e QR conduzem ao mesmo fluxo autorizado. A geolocalização obrigatória só é solicitada após Confirmar minha presença. |
| A43 | R10, R11 | Fechar, expirar, cancelar aula ou desativar conta entre emissão e conclusão invalida a autorização; não existe presença por ter começado o fluxo antes. |
| A44 | R11, R12 | Com geolocalização não exigida, confirmação depende das outras regras e não fica pendente por localização não fornecida. |

## 4. Geolocalização, reenvios e decisões

| ID | Requisitos | Cenário e resultado esperado |
| --- | --- | --- |
| A45 | R12 | Para raio 100 m: distância 60/precisão 20 aprova; 140/20 rejeita; 90/30 fica pendente. Resultado geográfico aprovado ainda depende das demais regras. |
| A46 | R12 | Fronteiras: `d+a=r` aprova; `d-a=r` com área cruzando o limite fica pendente. `d-a>r` rejeita. |
| A47 | R11, R12 | Permissão negada ou posição indisponível em tentativa autorizada/submetida e dentro do prazo gera pendência com motivo. Código inválido ou prazo vencido não gera pendência geográfica alternativa. |
| A48 | R13 | Primeira tentativa pendente e segunda rejeitada por estar fora do raio: primeira continua ativa, ambas ficam na cronologia, fechamento não aplica falta automática. |
| A49 | R13 | Nova tentativa usa código vigente e autorização nova. Se válida, supera pendência ainda não decidida e preserva a cronologia; o resultado não continua provisório apenas pela pendência já superada. |
| A50 | R13, R14 | Aprovação manual de pendência leva a presença; rejeição manual leva à decisão de ausência. Nova tentativa automática não sobrescreve a decisão explícita. |
| A51 | R14, R22 | Presença manual sem tentativa exige justificativa; auditoria a distingue de aprovação de pendência e mantém quem/quando/antes/depois. |
| A52 | R19 | Professores A e B leem a mesma versão: A aprova, B tenta rejeitar na versão antiga. Backend retorna conflito, mantém decisão de A e atualiza a interface de B. |
| A53 | R19 | Mesmo conflito entre admin e professor não admite bypass por privilégio. Correção posterior sobre versão atual exige nova ação e motivo e produz novo evento. |
| A54 | R19, R22 | Falha na gravação obrigatória de auditoria não deixa alteração de presença aplicada sem evidência. Reenvio de requisição não duplica efeitos nem eventos de uma mesma aplicação. |
| A55 | R19 | Requisições simultâneas de confirmação, fechamento e decisão manual têm resultado consistente: nenhuma duplicata, nenhuma aceitação automática fora do prazo, nenhuma decisão manual sobrescrita. |

## 5. Exceções e frequência

| ID | Requisitos | Cenário e resultado esperado |
| --- | --- | --- |
| A56 | R15 | Aula nunca aberta admite consolidação manual posterior, com rascunho sem efeito no percentual, lista elegível completa, revisão e motivo obrigatório para concluir. |
| A57 | R15 | Conclusão manual gera apenas os estados acadêmicos informados, sem QR, autorizações ou tentativas de localização artificiais, e inclui a aula na frequência. |
| A58 | R15 | Aula aberta ao menos uma vez recusa consolidação manual paralela, mesmo após indisponibilidade; ajustes preservam tentativas e utilizam os registros existentes. |
| A59 | R16 | Cancelar com chamada aberta encerra/invalida o fluxo; histórico permanece, nenhum registro entra nos totais e a aula não gera faltas pelo cancelamento. |
| A60 | R17 | Admin exclui ausência com motivo: continua ausente, aparece desconsiderada e sai do cálculo. Professor não consegue executar essa exclusão por acesso direto. |
| A61 | R17 | Exclusão em lote apresenta as ausências do aluno/turma/intervalo para revisão e aplica auditoria individual com a justificativa informada. Não converte presença ou altera matrícula. |
| A62 | R17, R18 | Revogação justificada preserva exclusão e revogação e volta a incluir a ausência, salvo se a própria aula estiver fora do cálculo, como por cancelamento. |
| A63 | R18 | Três presenças e uma ausência incluída resultam em 75%. Uma pendência adicional mantém 75%, mas provisório, e é exibida separadamente. |
| A64 | R18 | Se a pendência anterior vira ausência, resultado passa a 60%; se vira presença, passa a 80%. Sem outro motivo de provisoriedade, o indicador deixa de ser provisório. |
| A65 | R17, R18 | Três presenças, uma ausência incluída e uma ausência excluída resultam em 75%, não 60%; revogar a exclusão resulta em 60%. |
| A66 | R18 | Nenhum registro incluído mostra frequência ainda não calculada. Só pendências ou só ausências excluídas não produzem 0%. Zero presenças e uma ausência incluída produzem 0%. |
| A67 | R10, R18 | Na primeira abertura, aula não participa. Primeiro fechamento a inclui. Reabertura mantém seus registros no cálculo e marca provisório; novo fechamento remove essa causa, mas não pendências restantes. |
| A68 | R15, R18 | Aula nunca aberta sem consolidação manual concluída fica fora. Rascunho manual fica fora. Consolidação manual concluída é a exceção explícita e entra. |
| A69 | R08, R18 | Uma presença de piloto e uma ausência oficial não viram 50% oficial: apresentar piloto 100% e oficial 0%, nos respectivos conjuntos elegíveis. |
| A70 | R16, R18 | Cancelar aula previamente contabilizada remove seus registros do cálculo, inclusive se teve várias reaberturas ou pendências. |

## 6. Interfaces, privacidade e tempo

| ID | Requisitos | Cenário e resultado esperado |
| --- | --- | --- |
| A71 | R20 | Projeção mostra somente campos permitidos, tem tela cheia e atualiza códigos. Inspeção visual e da resposta destinada à projeção não revela dados individuais. |
| A72 | R20 | Fechamento/expiração remove códigos e mostra encerramento. Perda de sincronização é sinalizada, sem manter aparência de código válido. Painel de gestão continua separado. |
| A73 | R21 | Aluno consulta histórico próprio, inclusive matrícula encerrada, com modo e motivos compreensíveis. Não acessa registros de outro aluno por URL/API nem detalhes internos restritos. |
| A74 | R21 | Correção de professor/admin, cancelamento e exclusão atualizam o histórico do aluno. Não há formulário de contestação dentro do MVP. |
| A75 | R23 | Após tentativa aceita, pendente ou rejeitada com posição, banco e auditoria contêm somente os dados geográficos derivados permitidos e snapshot; não coordenadas do aluno. |
| A76 | R23 | Verificar também logs de requisições, erros, proxy e monitoramento com entradas sintéticas identificáveis: não podem persistir coordenadas de aluno, senhas ou tokens brutos. Coordenadas do local são permitidas no cadastro/snapshot. |
| A77 | R09, R23 | Editar local/raio depois de tentativa não muda distância registrada, motivo, resultado ou snapshot histórico. Sem posição, distância/precisão não são inventadas. |
| A78 | R23 | Revisão de arquitetura identifica onde ficam dados pessoais, vínculos, eventos, snapshots, logs e backups; apresenta estratégia para futura retenção/anonimização/exportação sem apagar indiscriminadamente registros preserváveis. Não pressupõe prazo legal universal. |
| A79 | R07, R24 | Alterar relógio do aluno/professor para antes/depois ou mudar seu fuso não prolonga código/autorização, não altera matrícula e não permite chamada fora do horário. |
| A80 | R24 | Planejamento, exibição e geração recorrente usam fuso da instalação de modo consistente, inclusive aulas atravessando meia-noite e fronteiras de data; auditoria usa instante do backend. |
| A81 | R24 | Testes com relógio controlado do backend cobrem início inclusivo, término exclusivo, códigos perto da rotação e autorizações perto do limite. Alterar fuso da instalação não reinterpreta histórico silenciosamente. |

## 7. Acessibilidade verificável

As verificações manuais abaixo complementam testes automáticos; ferramenta automática isolada não comprova acessibilidade.

| ID | Requisitos | Cenário e resultado esperado |
| --- | --- | --- |
| A82 | R25 | Usando somente teclado, concluir login/convite, digitar código, confirmar presença, consultar resultado e operar pendências/correções permitidas; foco é visível, ordem faz sentido e não há armadilha. |
| A83 | R25 | Com leitor de tela, campos, botões, erros e estado final têm nomes/mensagens compreensíveis. Diálogos e atualizações preservam contexto e foco. |
| A84 | R20, R25 | Atualizações do QR/contador e lista de presença não roubam foco nem anunciam continuamente informação que impeça utilizar o restante da tela. Fechamento, expiração e resultado são perceptíveis. |
| A85 | R25 | Presença, ausência, pendência, rejeição, piloto e modo de manutenção são compreensíveis sem distinguir cores. Código digitável funciona sem câmera. |
| A86 | R11, R25 | Se uma autorização expirar durante uso assistivo, interface explica o ocorrido e permite reiniciar com código vigente quando a chamada ainda está aberta; não cria presença nem pendência indevida. |

## 8. Operação e capacidade

| ID | Requisitos | Cenário e resultado esperado |
| --- | --- | --- |
| A87 | R02, R03, R26 | Em ambiente limpo, seguir documentação e `.env.example` para instalar via Compose, configurar domínio/HTTPS, criar owner com segredo e convidar por SMTP ou manualmente. Não há segredo real versionado. |
| A88 | R26 | Reiniciar/recriar containers preserva PostgreSQL conforme procedimento. Executar backup e restaurar em instalação de teste preserva dados, versões e histórico. |
| A89 | R26 | Entrar na primeira fase de manutenção bloqueia abertura/reabertura, mas mantém confirmação das chamadas existentes até fechamento. A fase de backup só começa após bloqueio de novas escritas e conclusão das em processamento. |
| A90 | R26 | Falha ou ausência do backup impede prosseguir à migração no procedimento oficial. Registrar versão de origem/destino e conjunto de migrações. |
| A91 | R26 | Atualização bem-sucedida só libera acesso após verificações. Falha de atualização/migração mantém bloqueio e permite restaurar backup+versão anterior antes da liberação. |
| A92 | R26 | Instruções de desenvolvimento sem Docker permitem executar frontend/backend e conectar ao PostgreSQL; não há dependência funcional da aplicação em Compose. |
| A93 | R27 | Executar a campanha de carga descrita abaixo no ambiente de referência; publicar medições, cenário, versão e resultado, sem declarar capacidade não medida. |
| A94 | R28 | Antes da versão pública, repositório identifica AGPL-3.0-only consistentemente, inclui texto/avisos necessários e documenta código correspondente e licenças das dependências efetivamente adotadas. |
| A95 | R29 | Demonstração identifica limitações e simulações; piloto mostra PILOT, mantém comparação com chamada habitual e não alimenta frequência oficial. Registrar os resultados da avaliação real antes de recomendar adoção oficial. |

## 9. Protocolo inicial de carga

### Ambiente e reprodutibilidade

- Máquina alvo: 4 vCPUs, 8 GB RAM, SSD; backend e PostgreSQL juntos. Registrar sistema, limites de recursos, versões, configurações de conexão e migrations.
- Usar base sintética representativa: até 10.000 contas, 5.000 alunos ativos, 100 chamadas abertas e turmas de 30–80 alunos.
- Disponibilizar quantidade suficiente de matrículas e tentativas para exercitar gravações novas e reenvios. Não contar somente consultas de presença já confirmada como prova de vazão de confirmação.
- Não confundir 30.000 tentativas em cinco minutos a 100/s com 30.000 presenças únicas. Reenvios e rejeições devem estar identificados.
- Gerador preferencialmente fora da máquina alvo; se não for possível, registrar a interferência. Esse arranjo é proposta de método, não aumento do hardware-alvo.

### Cargas e observação

- Fazer aquecimento separado e medir um cenário a 50 tentativas/s e outro com rajada sustentada de até 100 tentativas/s por cinco minutos.
- Uma tentativa lógica cobre obtenção de autorização com código vigente e submissão/validação/persistência. Documentar quantos requests HTTP isso gera, inclusive painel/projeção, sem igualar silenciosamente requests/s a tentativas completas/s.
- Medir latência por endpoint e duração de backend por tentativa; excluir espera humana, login e aquisição física de localização. Publicar a definição exata da métrica usada para julgar p95/p99.
- Misturar resultados válidos, código expirado, aluno inelegível, geolocalização aprovada/pendente/rejeitada, repetição, concorrência do mesmo aluno e fechamento durante processamento.
- Registrar distribuição de casos, taxa efetivamente oferecida e concluída, p50/p95/p99, erros, rejeições esperadas, CPU, memória, conexões, espera por locks e comportamento do PostgreSQL.
- Reportar confirmações bem-sucedidas separadamente: rejeições rápidas não podem esconder degradação no caminho que grava presença.

### Condições de aprovação

- Pelo menos 95% das respostas medidas em até 1 s e 99% em até 3 s; menos de 1% de falhas internas/inesperadas/indisponibilidade.
- Rejeições legítimas não são erros de serviço, mas não podem ser usadas para mascarar falha de validação ou saturação. Expiração artificialmente causada pela carga deve ser analisada.
- Consulta final da base e auditoria comprova ausência de duplicatas, de confirmações automáticas aceitas após o limite e de decisões manuais sobrescritas automaticamente.
- Integridade é obrigatória mesmo quando uma execução não atinge a meta de latência. Registrar reprovação e corrigir antes de repetir o cenário afetado.

## 10. Evidência de conclusão

O marco adicional D1 tem os cenários [DEMO-01 a DEMO-07](demonstracao-publica.md), sem substituir nem aprovar implicitamente os cenários A01–A95.

Cada entrega deve apontar quais cenários comprovou, com versão do código e tipo de evidência: teste automatizado, verificação manual, relatório de carga ou ensaio operacional. Cenários adiados continuam pendentes; não devem ser marcados como aprovados por estarem descritos aqui.

Interações ainda não fechadas na entrevista estão em [decisões técnicas](decisoes-tecnicas.md), e precisam ser resolvidas antes de testar a funcionalidade afetada.
