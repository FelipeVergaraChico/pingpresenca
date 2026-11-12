# ADR 0005 — Geração antecipada de aulas (E5.1)

Data: 02/10/2026. Escopo: R08/R24, A25/A80 e parte de D04. Não conclui E5 nem altera regras de chamada.

## Decisão

Professor vinculado e administração podem gerar aulas em turma ativa. O backend interpreta intervalo inclusivo de datas, dias da semana e horários no fuso da instalação. Término menor que início significa dia seguinte; horários iguais são recusados. O limite final se aplica à data local de início. Datas impossíveis e horários ambíguos/inexistentes (DST) invalidam o lote inteiro.

Um lote configura um horário compartilhado pelos dias selecionados, local autorizado, título/descrição e modo. Horários diferentes usam lotes separados. Intervalo máximo operacional de 366 dias (até 366 ocorrências por requisição); períodos maiores podem ser divididos. Não há limite permanente de aulas por turma. Prévia é limitada e paginada visualmente em grupos de dez, não um endpoint de histórico ilimitado. Feriados não são inferidos; as ocorrências são revisadas/canceladas individualmente.

Prévia não grava aulas. Confirmação reavalia autoridade, turma ativa, local e plano no backend. Hash da prévia inclui regra normalizada, fuso, versões da turma/local e ações previstas. Mudança relevante exige nova revisão (409). A confirmação é uma única transação: aulas, registro de geração, identidades de ocorrência e auditoria juntos. Reutiliza a serialização administrativa existente; não adiciona lock global ao tráfego de presença.

`lesson_generations` guarda regra, fuso, autor, instante e resultado; hash determinístico por turma torna reenvio de confirmação idempotente. `generated_occurrences` guarda início absoluto original e vínculo à aula. Identidade original não muda ao editar/cancelar a aula, evitando recriação do horário antigo. Futuro apagamento autorizado pode limpar o vínculo, mas preserva a identidade. Mesmo início já ocupado por aula avulsa é preservado e aparece assim na prévia. Sobreposições com inícios diferentes não são resolvidas automaticamente nem proibidas por uma regra nova implícita.

Repetição de lote já concluído retorna seu resultado original, sem atualizar aulas. Nova regra/período cria só ocorrências ainda não geradas/ocupadas, nunca altera as anteriores. Correções de horário/local/título continuam pelo editor individual e pelas proteções históricas existentes. Não há propagação de alterações de série.

Nenhuma sessão de chamada é criada/aberta pela geração. `LESSON_CREATED` identifica o lote em cada aula e `LESSONS_GENERATED` registra o resumo. Não muda elegibilidade, modo histórico ou snapshots de aberturas.

## Demonstração e operação

Rotas de recorrência permanecem fora da allowlist D1; interface oculta a função na demo. Ampliar cotas e acesso da demo é decisão separada. A migration 006 adiciona tabelas; o inventário explícito do reset de dados fictícios foi atualizado para manter a compatibilidade do comando existente. Nenhuma VPS/banco real é atualizado por esta entrega.

Aplicar migration antes de iniciar a versão nova. Em instalação já usada: manutenção e backup obrigatório antes da migração, conforme o procedimento oficial. Não executar reset de demo sobre dados institucionais.

## Limites e próximos recortes

Não inclui importação de usuários, SMTP, editor de séries em massa, feriados, consolidação manual ou exclusões de frequência. D04 está resolvida para geração; idempotência de importação continua aberta. Período da recorrência fica registrado no lote, sem reinterpretar o rótulo livre `term` da turma como datas.
