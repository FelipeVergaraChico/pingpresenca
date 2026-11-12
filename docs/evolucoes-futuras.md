# Evoluções futuras — sem inclusão automática no MVP

## Auditoria verificável (registrada em 15/10/2026)

Motivação: sugestão do professor de utilizar blockchain para reforçar a confiança nos registros. Registrar para avaliação futura, sem implementar nesta E5.

A proposta preferida para estudo é encadear hashes de eventos de auditoria, com formato canônico/versionado, sequência verificável e ferramenta de verificação/exportação. Correções continuam sendo novos eventos: não se reescreve a presença original nem sua justificativa. Um evento referencia o anterior; o seguinte é que referencia esse evento, quando existir.

Uma cadeia guardada apenas no mesmo banco não impede que alguém com controle completo da infraestrutura reescreva eventos e recalcule todos os hashes. Detectar essa ameaça exige referências de confiança fora desse domínio de controle, como checkpoints assinados e guardados independentemente ou ancoragem periódica externa. Blockchain pública seria uma alternativa de ancoragem a avaliar, não uma dependência obrigatória nem uma transação por presença.

Integridade verificável não comprova presença física nem torna verdadeiro um lançamento incorreto. Não prometer “afastar qualquer dúvida”, imutabilidade absoluta ou validade jurídica automática. Não publicar dados pessoais, justificativas, coordenadas ou registros acadêmicos em blockchain. Mesmo hashes exigem avaliação de privacidade e possibilidade de correlação.

Antes de implementar: definir ameaças, custódia/rotação de chaves, ordenação concorrente, detecção de remoção do final da cadeia, recuperação de backups, retenção/anonimização e custo operacional. Não conflitar com a política de ciclo de vida dos dados nem estabelecer retenção de 30 dias sem decisão específica.
