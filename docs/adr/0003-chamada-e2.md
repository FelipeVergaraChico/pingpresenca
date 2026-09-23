# ADR 0003 — Chamada ponta a ponta

Estado: adotada · 22/09/2026 · Escopo: E2.

## Modelo e autoridade

`003_attendance.sql` adiciona sessão lógica única por aula, aberturas separadas, autorizações, tentativas e estado atual único por aluno/aula. A separação permite reabertura/checkpoints futuros sem implementá-los agora. A primeira abertura fixa contexto, modo e snapshot da localização/política. As migrations anteriores não foram editadas.

PostgreSQL fornece o instante de decisão (`clock_timestamp()`), elegibilidade pelo início planejado, prazo e fechamento. A duração padrão institucional começa em 10 minutos, é alterável por administração com versão/justificativa e pode ser ajustada pelo professor na abertura (1–1440 minutos); sempre limitada ao fim da aula. O cliente só exibe estimativas temporais, usando tempo decorrido monotônico, sem decidir validade.

## Desafio, autorização e confirmação

- QR/código rotacionam a cada 30 segundos, sem tolerância à janela anterior. HMAC-SHA256 usa segredo aleatório de 256 bits por abertura e finalidades distintas para código digitável de seis dígitos e desafio QR de 256 bits. Não há segredo de autenticador entregue ao aluno; isto não é um cadastro Authy/TOTP pessoal.
- O QR transporta aula/desafio no fragmento da URL, não em query/path de logs HTTP. A projeção só é obtida por professor vinculado/admin autenticado e não retorna lista, coordenadas ou auditoria.
- Após autenticação e elegibilidade, o backend valida o desafio vigente. Há orçamento persistido de 10 apresentações por minuto/aluno/abertura, sem bloquear uma turma inteira pelo IP compartilhado. Parâmetros devem ser calibrados com evidência antes do piloto.
- Autorização curta aleatória dura até 60 segundos, limitada ao prazo da abertura/fim da aula. Apenas o hash fica armazenado. Pertence ao aluno e à abertura e deixa de funcionar quando esta fecha. Ela não cria tentativa nem presença.
- O aluno confirma explicitamente sua conta/aula. Só então a interface chama a geolocalização quando obrigatória, com timeout de 15 segundos. Negação/indisponibilidade/timeout resultam em pendência apenas se a autorização continuar válida ao concluir. Latitude/longitude existem apenas no corpo processado em memória; nenhum estado persistente do cliente ou banco as recebe.
- Validação conservadora: `distância + accuracy <= raio` aceita; `distância - accuracy > raio` rejeita; interseção deixa pendente. Política opcional dispensa a posição. Haversine calcula distância em metros; auditoria retém resultado, motivo, distância/precisão quando existentes, instante e vínculo ao snapshot. Isso não prova presença física nem impede localização adulterada ou compartilhamento de códigos.
- Uma tentativa por autorização e um registro por aluno/aula são garantidos no banco. Reenvio da mesma autorização retorna o resultado original, inclusive após fechamento, sem nova confirmação. Depois de transporte incerto, a UI consulta o resultado por endpoint de leitura, sem guardar/retransmitir coordenadas. Nova tentativa exige novo código vigente e nova autorização.

## Transações, decisões e fechamento

Cada operação de chamada usa lock por aula e barreira compartilhada contra alterações administrativas E1. Abertura usa a barreira exclusiva para fixar contexto junto das regras acadêmicas. Confirmações de aulas diferentes não são serializadas por um lock exclusivo global. A sessão/permite vínculo é verificada depois de adquirir o lock; decisões manuais usam versão otimista. Isto é fundação de integridade, não prova das metas de carga.

A aceitação automática se lineariza no INSERT da tentativa, que verifica prazos com o relógio do banco depois de esperar os locks. Fechamento e decisão manual da mesma aula não atravessam a transação. Erro de auditoria desfaz a operação. Uma rejeição de negócio posterior a um fechamento automático mantém o fechamento, usando savepoint; falhas SQL desfazem a transação inteira.

**D02 resolvida:** a decisão considera o registro atual e todas as suas pendências apresentadas, preservadas individualmente. Não há aprovação parcial. Uma tentativa posterior rejeitada preserva o estado pendente, mas incrementa sua versão para impedir decisão baseada em cronologia desatualizada. Uma confirmação válida supera pendências ainda não analisadas. Decisões manuais continuam protegidas; correção posterior exige nova ação, versão e justificativa. Presença manual sem tentativa prévia é diferente de aprovação de pendência na origem e na auditoria.

O worker interno consulta prazos a cada segundo, sem ciclos sobrepostos. Fechamento é idempotente e transacional; instâncias concorrentes revalidam o lock. Leituras/ações da aula também consolidam abertura vencida. O atraso do worker não estende a validade: endpoints verificam o prazo diretamente. Reinício retoma aberturas vencidas no banco. Cada ausência automática e fechamento têm eventos, com ator SYSTEM quando apropriado.

Fechar insere ausência somente para matrícula vigente no início planejado e sem estado existente. Pendência não vira falta. Aulas nunca abertas continuam fora do cálculo; primeira consolidação habilita frequência por peso igual e modo separado, sem pendências no denominador. Zero dados retorna percentual nulo. Reabertura, cancelamento, exclusões e consolidação manual completa aguardam seus marcos e não possuem atalhos nesta entrega.

## Interface, privacidade e dependências

- Polling simples: projeção 1 segundo; painel/histórico 3 segundos, sem sobreposição habitual. Falha de rede é visível; projeção suspende códigos quando perde sincronização e não mantém aparência válida indefinidamente. Contadores não são regiões de anúncio contínuo. Nenhuma atualização troca automaticamente uma decisão em análise.
- QR gerado localmente com [`qrcode` 1.5.4](https://github.com/soldair/node-qrcode), licença MIT; não há serviço externo recebendo desafios. Código digitável permanece alternativa acessível. A skill frontend-design orientou preservar a linguagem visual existente e corrigir contraste, não redesenhar o produto.
- Aluno só consulta seu histórico/tentativas, sem evidência geográfica detalhada, justificativas administrativas ou dados dos colegas. Identificadores estáveis relacionam fatos e perfis separados. Tentativas/autorizações/auditoria não copiam nome/e-mail. Retenção/exportação/anonimização continuam futuras; devem incluir hashes e sementes de aberturas vencidas, evidências derivadas, justificativas, logs e backups. Não se estabelece retenção indefinida nem prazo legal universal.
- Logs padrão não registram corpo das solicitações, cookie, QR ou coordenadas; erros internos são sanitizados. Telemetria/proxy de terceiros não está coberta por essa garantia: documentar e verificar antes do piloto/produção.
- Sem Redis, fila, WebSocket ou nova infraestrutura. Compose permanece referência, com `NPM_REGISTRY` opcional apenas para obtenção de dependências em redes restritas.

As evidências e limites de aceitação estão no [relatório E2](../entregas/e2.md).
