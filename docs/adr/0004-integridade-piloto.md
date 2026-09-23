# ADR 0004 — Integridade operacional da E3

Data: 23/09/2026. Escopo: E3, sem iniciar E4/E5/E6.

## Decisões

- Uma `attendance_session` por aula; reabrir acrescenta uma `attendance_opening`, com segredo aleatório, prazo próprio e snapshot atual. Justificativa obrigatória. Reabrir e fechar recebem o identificador da abertura observada para rejeitar requisições atrasadas de outra abertura. O relógio PostgreSQL continua sendo a autoridade; o limite do fim da aula permanece exclusivo.
- Cancelamento é irreversível no MVP: `cancelled_at` e motivo na aula, alteração versionada e auditada. Interrompe códigos/autorizações e preserva registros anteriores. Não executa consolidação de faltas pelo cancelamento. Se um fechamento já ocorreu antes, suas faltas ficam históricas, mas a aula inteira é excluída da frequência. Correções históricas continuam auditadas.
- Trocar local exige chamada fechada, versão observada e justificativa. Não muda snapshots anteriores; a próxima abertura copia a política atual do cadastro autorizado. Coordenadas de aluno continuam apenas em memória durante validação.
- Mantidos locks transacionais por aula e barreira compartilhada com operações administrativas. Múltiplos workers podem concorrer para fechar: o primeiro fecha, os demais não duplicam eventos ou faltas. Não há necessidade demonstrada de Redis/fila.
- Recuperação assistida: token aleatório de 256 bits, hash no banco, 15 minutos, uso único; emissão substitui links anteriores. Consumo verifica novamente conta ativa, autoridade atual do emissor e expiração, troca somente senha, revoga sessões/outros links e audita na mesma transação. A mudança de papel revoga recuperações vinculadas ao alvo ou ao emissor. O endereço não passa a verificado.
- Administração recupera alunos/professores; somente owner recupera administradores, incluindo contas com papéis acumulados. Nenhuma rota web recupera owner. CLI de manutenção localiza somente o owner existente e exige motivo, sem segredo de bootstrap, senha em argumento ou criação de conta.
- Links privados usam fragmento da URL. Não registrar tokens, senhas, cookies ou payloads de geolocalização. Quem recebe o link possui temporariamente a capacidade de redefinir a senha: conferir identidade e entregar por canal confiável é responsabilidade operacional explícita.
- Cliente HTTP limita espera a 15 segundos, sem repetir escritas automaticamente. Resposta perdida é ambígua; a confirmação de presença mantém consulta de resultado antes de nova tentativa. Interface preserva versão do formulário em edição apesar das atualizações de fundo.
- D09: carga preliminar publica métricas separadas de autorização, confirmação (incluindo reenvios) e fluxo completo. Não confundir chamadas HTTP com tentativas distintas, nem excluir silenciosamente leitura de projeção do volume total. Login/GPS físico ficam fora da medição sintética.

## Consequências e validação

Migration aditiva `004_pilot_integrity.sql`; anteriores inalteradas. Atualização exige backup e parada dos escritores. Sem alteração automática no banco do mantenedor.

Testes em `backend/test/e3.integration.test.ts`, `frontend/src/attendance/Operations.test.tsx`, fluxo Playwright ampliado e ensaio de restauração em `scripts/compose-smoke.mjs`. Relatório: [E3](../entregas/e3.md). Rate limit de recuperação usa IP de conexão, sem confiar livremente em cabeçalhos de proxy; atrás de proxy, o orçamento é compartilhado e conservador.

A E3 não implementa SMTP, autoatendimento por e-mail, desativação/retenção completas, importação, recorrência, consolidação manual coletiva ou exclusão administrativa de faltas: continuam nos respectivos marcos.
