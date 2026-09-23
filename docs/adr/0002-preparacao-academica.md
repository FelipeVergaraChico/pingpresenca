# ADR 0002 — Preparação acadêmica E1

Estado: adotada · 10/09/2026 · Escopo: E1, sem chamada automática.

## Identidade e convites

- Conta convidada usa `password_hash = NULL`, sem senha provisória conhecida pelo administrador. Login continua recusado até o aceite; a flag de desativação permanece independente.
- Papéis se acumulam. OWNER nunca é removido pelo editor. Somente OWNER concede/remove ADMIN ou gerencia uma conta que já possui ADMIN/OWNER, inclusive contas administrativas também docentes. Nome e identificador podem ser editados com motivo/versão; alteração de e-mail, desativação e recuperação ficam nos marcos acordados.
- Identificador institucional é separado do e-mail e único quando informado. Política obrigatória afeta novos cadastros/edições, não desativa retroativamente contas existentes. O owner inicial pode ser complementado após o bootstrap.
- Convite manual dura 48 horas e contém 256 bits aleatórios; somente SHA-256 fica no banco. Token vai no fragmento `#invite=` do link, não no caminho/query enviado ao servidor. Inspeção e aceite usam POST, sem logs de corpo; não há persistência do token em Zustand/localStorage. O painel mostra o link somente naquela interação.
- Reemissão revoga convites anteriores. Mudança de papéis também revoga os links pendentes, evitando que convite emitido por admin antes de promoção continue dando acesso a uma conta agora privilegiada. Depois da mudança, o responsável autorizado deve emitir novo convite.
- O aceite define somente senha e consome o link atomicamente; nunca recebe papel, turma ou canal do cliente. Expiração é revalidada no consumo pelo relógio do banco. Conta já ativada não admite convite de redefinição: recuperação é outro fluxo.
- Canal `EMAIL`/endereço de entrega estão modelados, mas envio e aceite desse canal não são expostos na E1. Convite manual sempre mantém `email_verified_at` vazio. Não há recuperação baseada em e-mail nesta entrega.

## Planejamento, tempo e locais

- Disciplina e oferta são separadas. Oferta tem nome, período letivo textual, turno, professores, estado e modo padrão. Recorrência, datas de geração do período e arquivamento continuam nos respectivos marcos.
- Todos os locais do catálogo administrativo são autorizados para os professores vinculados às turmas da instalação. Não há ACL adicional por prédio nesta entrega. Somente administração cria/edita coordenadas, raio e obrigatoriedade.
- Aulas são avulsas. A API aceita datas/horas locais sem offset, converte com o fuso persistido e recusa data inválida ou hora ambígua/inexistente, sem ajuste silencioso. Frontend exibe o fuso em inputs e listas, independentemente do dispositivo.
- D07 (recorte E1): alterar padrão da turma afeta somente novas aulas. Aulas já planejadas mantêm o modo; a edição individual é explícita e versionada. Não há edição de fuso nesta entrega. Geração/propagação em lote continua na E5.
- Matrículas são períodos `[início, fim)`. A restrição de exclusão PostgreSQL usa `tstzrange` com `btree_gist`, protegendo contra sobreposição mesmo fora do guard HTTP. Não basta consultar antes de inserir. Referências: [ranges e exclusão](https://www.postgresql.org/docs/16/rangetypes.html#RANGETYPES-CONSTRAINT) e [btree_gist](https://www.postgresql.org/docs/16/btree-gist.html).
- O encerramento preserva o período; um retorno cria outro. E1 não oferece edição de início nem reabertura do período encerrado. Guardas para contexto fixado impedem retroatividade que altere a elegibilidade; cenários completos com chamada real pertencem à E2/E3/E5.
- Correção REV-07: término programado no futuro não é período já encerrado. A administração pode antecipá-lo, nunca prorrogá-lo por esse endpoint. O relógio do PostgreSQL decide se o período já terminou e fornece `can_end` à interface. A guarda histórica verifica apenas aulas no intervalo removido `[novo término, término anterior)`. Versão e auditoria transacional preservam o término anterior real. Não se reabre matrícula nem se altera seu início.
- `context_locked_at` e `mode_locked_at` são fundamentos sem endpoint de escrita pública. E1 nunca inicia chamada/rascunho nem preenche esses campos. Testes usam marcadores sintéticos para verificar bloqueios, sem considerar o fluxo de chamada implementado.
- `policySnapshot` produz uma cópia imutável e versionada dos valores do local. `/planning` retorna uma **prévia**, não cria abertura nem snapshot histórico. A E2 deverá persistir essa cópia junto à abertura na mesma transação; nunca usar o cadastro mutável para reinterpretar tentativas antigas.

## Autorização, concorrência e auditoria

- Rotas E1 verificam sessão e papéis atuais no backend. Professores acessam dados de turmas vinculadas; alunos recebem apenas aulas elegíveis dos próprios períodos, sem lista de colegas, coordenadas ou políticas detalhadas.
- Para o volume administrativo inicial, um advisory lock transacional da instalação serializa operações E1 e as verificações de autorização correspondentes. Assim, retirar um papel/vínculo e uma escrita baseada nele têm ordem definida. Não usar esse lock global no tráfego de confirmação da E2/E3: esse tráfego exige locks por recurso e testes de carga.
- Edições carregam versão. Conflito retorna 409 e exige atualização/revisão; administrador não tem bypass. Matrícula sobreposta e duplicidade recebem mensagem de domínio, sem expor SQL/credenciais.
- Estado e eventos são gravados na mesma transação. Auditoria de perfil registra campos/versões, sem copiar nome/e-mail/identificador a cada edição; eventos de papéis e planejamento incluem os valores acadêmicos pertinentes. Links e senhas não são auditados em claro.
- As fundações de limite por IP continuam conservadoras, sem confiança arbitrária em `X-Forwarded-For`. Calibrar limites/identidade do proxy com evidência antes do piloto; esta entrega não declara metas de carga cumpridas.

## Migração e limites

`002_academic_preparation.sql` é aditiva; não modifica `001_foundation.sql` nem apaga owner/sessões/auditoria. Requer disponibilidade de `btree_gist` no PostgreSQL e permissão da credencial de migration para instalá-la. O banco da instalação real não é migrado pelos testes.

Antes de migrar uma instalação existente: parar escritas e fazer backup. O procedimento oficial completo de manutenção/restauração continua pendente; a E1 não autoriza dispensar o backup. Consulte o [relatório E1](../entregas/e1.md) para evidências e limites.

### Correções operacionais e de interface da revisão E0/E1

- REV-06: inicialização e `/api/health` comparam nomes e checksums das migrations aplicadas com o mesmo manifesto usado pelo migrador. Schema ausente, incompleto, desconhecido ou divergente impede iniciar a API; health retorna 503. A verificação é somente leitura, sem migração automática, reparo de checksums ou exposição de credenciais. Não detecta toda alteração manual de DDL feita fora do migrador.
- REV-01/03/04: formulários são identificados pelo recurso; convite é remontado por token e somente pode ser aceito após inspeção do token atual. Respostas obsoletas não substituem a prévia atual nem a URL de outro convite.
- REV-02: o modo inicial de nova aula acompanha o padrão da turma enquanto o usuário não o tiver escolhido explicitamente. Outros campos do rascunho não são apagados. Aulas já existentes não são convertidas.
- REV-05: `ActionForm.onSave` pode retornar uma função de atualização somente de leitura, executada após confirmar a gravação. Falha nessa segunda fase informa que salvou e oferece repetir apenas a leitura. Reenvio da mesma criação permanece bloqueado; depois de atualizar, editar campos permite nova submissão consciente. Ações sem atualização posterior, como gerar outro convite, continuam repetíveis depois de concluídas, nunca simultaneamente.
