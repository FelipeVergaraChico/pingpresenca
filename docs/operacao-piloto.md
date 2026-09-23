# Operação e recuperação para o piloto E3

Use turmas/aulas `PILOT`, em paralelo ao método habitual. Não recomendar frequência oficial com base somente nos testes sintéticos.

## Recuperar acesso

Na área administrativa, selecione uma conta já ativada em **Contas e convites → Recuperar acesso**. Confira a identidade fora do sistema, informe motivo e entregue o link à pessoa correta. Validade de 15 minutos, uso único. Gerar outro invalida o anterior. A pessoa escolhe a senha; a conclusão revoga todas as suas sessões e demais recuperações. Não verifica o e-mail, não muda papéis, turmas ou frequência.

Admin comum não recupera admin/owner, inclusive em contas com papéis acumulados. Owner pode recuperar admin. Para o **owner**, somente no servidor configurado para a instalação:

```sh
# Desenvolvimento, na raiz, após migrations:
npm run recover:owner --registry=https://registry.npmmirror.com -- --reason "Identidade do responsável conferida presencialmente"

# Compose (usa o código compilado, sem instalar dependências):
docker compose exec -T backend node backend/dist/identity/recover-owner-cli.js --reason "Identidade do responsável conferida presencialmente"
```

O comando mostra um link confidencial, não uma senha. Não grave sua saída em logs, tickets ou repositório. Não cria owner, não reabre bootstrap e não depende de `BOOTSTRAP_SECRET`. O servidor deve estar migrado; `PUBLIC_ORIGIN` precisa ser a origem acessível por quem vai usar o link. O histórico distingue `INFRASTRUCTURE` de recuperação administrativa.

## HTTPS e indisponibilidade

O mantenedor já confirmou leitura física do QR e presença via celular/HTTPS em 23/09/2026. O túnel não permanece ativo. Para repetir, seguir [teste móvel](teste-celular.md) ou `npm run dev:tunnel --registry=https://registry.npmmirror.com`, com dados de teste. Certificado/domínio do piloto definitivo precisam de validação na instalação escolhida.

Ao perder conexão, não presumir sucesso nem repetir decisões às cegas. Atualize/consulte o resultado. Os prazos não pausam enquanto a API está fora: ao retornar, validações recusam confirmação vencida e o worker/read recupera o fechamento pendente de forma idempotente. As contas só conseguem entrar após serviço restabelecido.

## Backup e atualização: janela de manutenção obrigatória

Esta é a referência operacional mínima exercitada na E3. A distribuição e matriz completa de atualização/rollback entre releases continuam na E6. **Backup antes de migration não é opcional.** Não atualizar durante aula/chamada ativa. Agende janela, avise os usuários, feche/revise chamadas e aguarde operações em andamento.

1. Registre versão atual, migrations aplicadas, identificação das imagens (`docker compose images`) e preserve o código/imagens/Compose da versão anterior. Guarde configurações/segredos em armazenamento privado separado. Não dependa somente de uma tag mutável.
2. Suspenda frontend e backend, incluindo todos os processos dev/réplicas/workers que possam escrever no mesmo banco. No Compose de referência:

```sh
docker compose stop frontend backend
docker compose ps
```

3. Em diretório privado de backups, escolha **um nome novo** (o redirecionamento sobrescreve arquivo existente). Exemplo para a versão E2:

```sh
umask 077
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > pingpresenca-0.3.0-e2-antes-e3.dump
test -s pingpresenca-0.3.0-e2-antes-e3.dump
docker compose exec -T postgres pg_restore --list < pingpresenca-0.3.0-e2-antes-e3.dump
```

**Pare se qualquer comando falhar.** Listar o arquivo não comprova restauração: ensaie em banco separado conforme abaixo e mantenha cópia protegida fora do servidor. O dump contém dados pessoais, hashes de credenciais e sessões; restrinja acesso e retenção.

4. Só depois do backup aprovado, aplique o código da versão nova e construa/migre:

```sh
NPM_REGISTRY=https://registry.npmmirror.com docker compose build
docker compose run --rm migrate
docker compose up -d --wait backend
docker compose exec -T backend node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
docker compose up -d --wait frontend
```

Mantenha acesso público bloqueado no proxy até verificar login, versão, histórico e uma aula sintética. Só então libere o serviço. Em desenvolvimento: pare `npm run dev`, mantenha apenas banco, faça backup, rode `npm run db:migrate --registry=https://registry.npmmirror.com`, e reinicie.

## Ensaio de restauração / falha de atualização

Nunca restaure por cima do banco ativo para testar. Exemplo com banco **novo**, cujo nome não pode existir:

```sh
docker compose exec -T postgres sh -c 'exec createdb -U "$POSTGRES_USER" pingpresenca_restore_20260923'
docker compose exec -T postgres sh -c 'exec pg_restore -U "$POSTGRES_USER" -d pingpresenca_restore_20260923 --exit-on-error --no-owner' < pingpresenca-0.3.0-e2-antes-e3.dump
```

Não prossiga se `createdb` ou `pg_restore` falhar. Para rollback mantenha a manutenção; recoloque **código/imagens anteriores** compatíveis com o backup, selecione explicitamente o banco restaurado em `POSTGRES_DB` no ambiente do backend (ou `DATABASE_URL` no desenvolvimento), recrie a API e confira health/migrations/login/histórico antes de liberar acesso. Preserve o banco que falhou para diagnóstico controlado; não apague volumes. Reverter código sem restaurar o banco não desfaz uma migration.

`npm run test:compose --registry=https://registry.npmmirror.com` ensaia automaticamente parar escritores, dump custom, restore em outro banco, contagens de contas/auditoria/migrations e login/bootstrap pós-restauração. Ele usa um projeto descartável, nunca a instalação real. O ensaio não substitui testar o backup da instituição e a versão exata de rollback.
