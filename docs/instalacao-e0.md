# Instalação e desenvolvimento — base E0 e E1

Este guia cobre a primeira instalação e a configuração herdada da base E0. A E1 acrescenta uma migration aditiva e convite manual; consulte o [roteiro E1](entregas/e1.md). Não substitui o futuro procedimento oficial de atualização com manutenção, backup obrigatório e restauração, previsto na E6.

Para o passo a passo separado por ambiente, consulte o [README: desenvolvimento e produção](../README.md), incluindo o exemplo de proxy HTTPS no host. Este documento complementa o README com a referência de configuração da E0.

## Pré-requisitos e configuração

- Docker com Compose para a instalação de referência.
- Para desenvolvimento: Node.js 22.12 ou superior da linha 22, npm e acesso a PostgreSQL 16. A aplicação não depende de Docker.
- Disponibilidade de portas de loopback: 8080 para Compose, 5173/3000 para frontend/API locais e 54329 para PostgreSQL publicado pelo Compose. Não expor o PostgreSQL à rede pública.

Copie `.env.example` para `.env`. Gere dois segredos independentes com o comando abaixo, uma vez para a senha do banco e outra para o segredo de bootstrap:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Guarde os valores apenas em `.env`/gerenciador de segredos. Não use os placeholders do exemplo, senhas de testes ou o mesmo segredo para as duas finalidades.

| Variável | Uso |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Banco e credenciais da instalação de referência. |
| `POSTGRES_HOST`, `POSTGRES_PORT` | Conexão da API local; no Compose, a API usa host interno e porta 5432. |
| `DATABASE_URL` | Alternativa opcional para API fora do Compose; prevalece sobre os campos separados. Faça percent-encoding de credenciais na URL. |
| `INSTALLATION_NAME` | Nome utilizado na primeira inicialização e exibido na interface. Não renomeia silenciosamente uma instalação existente. |
| `INSTALLATION_TIME_ZONE` | Fuso IANA inicial, por exemplo `America/Sao_Paulo`. Divergência com o banco impede iniciar a API; não desloca histórico. |
| `BOOTSTRAP_SECRET` | Segredo de pelo menos 32 caracteres aleatórios, exclusivo do primeiro owner. Pode ficar vazio depois do bootstrap. |
| `PUBLIC_ORIGIN` | Origem exata do navegador, sem barra final/caminho: `http://localhost:8080` ou `http://localhost:5173`. |
| `COOKIE_SECURE` | `false` somente para desenvolvimento HTTP em loopback; `true` para HTTPS. |
| `SESSION_TTL_SECONDS` | Validade no servidor; padrão 8 horas, configurável entre 60 e 86400 segundos. |
| `WEB_PORT` | Porta de loopback do frontend servido pelo Compose. Ajuste também `PUBLIC_ORIGIN`. |
| `API_HOST`, `API_PORT` | Endereço da API fora do Compose; padrões 127.0.0.1:3000. |

`.env` nunca deve ser versionado. A interface não recebe segredo de bootstrap por variável de build nem credenciais do banco. O usuário informa o segredo somente no formulário inicial.

## Primeira instalação via Compose

Com `.env` configurado na raiz:

```sh
docker compose build
docker compose up -d --wait postgres
docker compose run --rm migrate
docker compose up -d --wait backend frontend
```

O serviço `migrate` é uma operação explícita. Iniciar a API não executa automaticamente migrations. A migration inicial é transacional e registrada com nome, checksum e data; execuções repetidas não apagam registros.

Acesse [localhost:8080](http://localhost:8080), confira instalação/fuso, informe nome, e-mail pessoal ou institucional, senha de 12–128 caracteres e segredo inicial. O formulário cria apenas o owner, sem verificar o e-mail. Depois, entre com e-mail e senha.

Após concluir, esvazie/remova `BOOTSTRAP_SECRET` de `.env` e recrie somente a API para atualizar seu ambiente:

```sh
docker compose up -d --force-recreate backend
```

Mesmo antes dessa remoção, o backend já bloqueia qualquer segundo bootstrap. O segredo inicial não é senha do owner nem meio de recuperação. Login não devolve token no JSON; o navegador recebe cookie HttpOnly e a sessão correspondente é validada no PostgreSQL.

**Seed:** não é necessário nem existe nesta entrega. Migrations criam estrutura; o usuário cria sua conta. Os dados de teste só existem nos ambientes descartáveis dos testes.

## Persistência e parada

Os dados ficam no volume nomeado `postgres_data` do projeto Compose. Parar/recriar containers normalmente preserva esse volume:

```sh
docker compose down
docker compose up -d --wait postgres backend frontend
```

Não adicionar `--volumes` ao comando da instalação real: ele apagaria o banco. Os scripts de teste utilizam essa opção somente em seus projetos aleatórios e isolados.

## Frontend e backend fora do Docker

Pode-se usar PostgreSQL 16 nativo/remoto, com um banco e usuário já provisionados e permissão para criar a estrutura. Nesse caso, configure host/porta/banco/senha ou `DATABASE_URL`; não é preciso nenhum container.

Alternativamente, use apenas `docker compose up -d --wait postgres` para fornecer o banco. Frontend e backend continuam executando no host.

No `.env` da raiz, use:

```dotenv
PUBLIC_ORIGIN=http://localhost:5173
COOKIE_SECURE=false
API_HOST=127.0.0.1
API_PORT=3000
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=54329
```

Para PostgreSQL nativo, ajuste a porta para a efetivamente utilizada, normalmente 5432. Mantenha as outras variáveis de instituição e credenciais preenchidas.

```sh
npm ci
npm run db:migrate
npm run dev
```

Vite publica [localhost:5173](http://localhost:5173) e encaminha `/api` ao backend. Os dois processos podem ser iniciados separadamente com `npm run dev -w backend` e `npm run dev -w frontend`. `API_PROXY_URL` é uma opção do servidor de desenvolvimento se a API estiver em outro endereço. Para execução compilada, use `npm run build` e `npm start -w backend`.

## Fronteira de publicação

O Compose E0 publica HTTP somente em loopback. Para domínio externo, é necessário um proxy HTTPS à frente, `PUBLIC_ORIGIN` correspondente e cookie seguro. A API recusa configuração HTTP pública; não se deve desativar a validação para contornar esse requisito.

O README documenta um exemplo de configuração de domínio/HTTPS, ainda sem validação de certificado público neste ambiente. Convites manuais estão disponíveis na E1. Provisionamento e validação operacional completos, SMTP e atualização/restauração continuam nos marcos previstos. Não executar esta base como controle oficial de frequência. O aplicativo ainda não possui funcionalidades de chamada.

O proxy interno serve frontend e API no mesmo origin. As mutações exigem `Origin` igual a `PUBLIC_ORIGIN`; requisições HTTP de diagnóstico precisam informá-lo explicitamente. Não há CORS liberado nem confiança arbitrária em cabeçalhos de proxy.

## Verificação e diagnóstico

```sh
npm run typecheck
npm test
npm run build
npm run test:integration
PLAYWRIGHT_CHANNEL=chrome npm run test:browser
npm run test:compose
```

- Integração cria um PostgreSQL temporário e recusa execução contra nome de banco que não seja de teste. Exercita duas instâncias da API concorrendo.
- Navegador usa portas 3105/5175, banco próprio e contas sintéticas. Chrome instalado é opcional; com Chromium do Playwright, omita `PLAYWRIGHT_CHANNEL`.
- Compose cria um projeto aleatório, faz a primeira instalação, cria owner/login, recria containers mantendo volume e comprova a persistência. Depois remove somente seu projeto e volume temporários.
- `/api/health` verifica conexão e compatibilidade do manifesto de migrations (nomes/checksums), informa versão quando pronto e retorna 503 quando incompatível/indisponível. A API também verifica o schema antes de iniciar. `/api/installation` mostra informações públicas mínimas. `/api/admin/installation` exige sessão owner/admin e informa migrations.

Se a API informar `Banco incompatível com esta versão`, confira a versão do código e as migrations. Em desenvolvimento, aplique as migrations pendentes com `npm run db:migrate` e reinicie a API. Em uma instalação existente, suspenda escritas e faça backup **antes** de migrar; em Compose use a imagem correspondente e `docker compose run --rm migrate`. Não apague o volume, não refaça o bootstrap e não altere checksums para contornar a verificação. Se houver migration desconhecida ou checksum divergente, restaure o código correspondente antes de seguir o procedimento de atualização. Nenhuma migração é executada automaticamente ao iniciar a API.
- Nenhum script de teste deve receber credenciais reais. Não habilitar traces com senhas reais; as capturas atuais são de contas sintéticas.

As evidências e limites da cobertura estão em [E0](entregas/e0.md). Falha por acesso a Docker, rede ou IPC deve ser distinguida de falha do aplicativo e reexecutada com as permissões locais apropriadas.
