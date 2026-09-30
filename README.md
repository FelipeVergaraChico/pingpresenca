# Ping Presença

Software livre de chamada para comunidades de ensino. React + TypeScript + Zustand, Node.js + TypeScript e PostgreSQL. Licença **AGPL-3.0-only**.

## Estado atual

**E3 — Integridade operacional (`0.4.0-e3`).** Além da chamada ponta a ponta, há reabertura com novo prazo/snapshot, cancelamento auditado, troca justificada de local, recuperação assistida de acesso e comando restrito ao servidor para recuperar o owner. Consulte [operação, backup/restauração e recuperação](docs/operacao-piloto.md) e [evidências e limites](docs/entregas/e3.md). O teste humano com leitor de tela continua pendente, com lembrete em 30/09/2026 às 9h. Não é uma versão pública pronta para frequência oficial.

A [documentação de produto](docs/README.md) é a fonte de verdade. Consulte [uso, evidências e limites da E2](docs/entregas/e2.md), [decisões da E2](docs/adr/0003-chamada-e2.md) e [referência de instalação](docs/instalacao-e0.md). Os relatórios E0/E1 permanecem como registros históricos.

**Regressões anteriores:** os sete achados da [revisão E0/E1](docs/entregas/revisao-e0-e1.md) foram [corrigidos e testados](docs/entregas/correcoes-e0-e1.md), com regressões mantidas na E2. A API recusa inicialização com migrations pendentes ou incompatíveis.

**Já tem uma instalação E0/E1/E2?** A E3 adiciona `004_pilot_integrity.sql`, sem alterar migrations anteriores. Pare os processos de escrita, faça **backup obrigatório** e siga o [procedimento de atualização](docs/operacao-piloto.md). No desenvolvimento, execute `npm run db:migrate --registry=https://registry.npmmirror.com` e depois `npm run dev --registry=https://registry.npmmirror.com`. Não refaça o bootstrap nem apague o volume. Esta implementação não migrou o banco da sua instalação.

**Rede com bloqueio do registry:** use `npm ci --registry=https://registry.npmmirror.com`. Para builds Compose, use `NPM_REGISTRY=https://registry.npmmirror.com docker compose build`; o argumento altera somente a obtenção de pacotes, não a arquitetura ou configuração de presença.

## Qual modo de execução usar?

Para ler o QR com um celular, consulte [teste móvel com HTTPS antes da produção](docs/teste-celular.md). `localhost` no QR aponta para o próprio celular.

| Objetivo | O que executar | Endereço |
| --- | --- | --- |
| Desenvolver com atualização automática | Apenas PostgreSQL no Compose; frontend e backend com `npm run dev` | `http://localhost:5173` |
| Desenvolver sem Docker | PostgreSQL 16 já instalado e `npm run dev` | `http://localhost:5173` |
| Testar os builds localmente | Compose completo | `http://localhost:8080` |
| Hospedar em um servidor | Compose completo e proxy HTTPS no host | Seu domínio HTTPS |

**Não é preciso subir o Compose completo para desenvolver.** O mesmo `compose.yaml` permite iniciar somente o serviço `postgres`. Não há um Compose separado para desenvolvimento.

Os comandos abaixo devem ser executados na raiz do repositório, em um terminal Linux/macOS. Use instalações, bancos e segredos separados para desenvolvimento e produção; não execute testes ou desenvolvimento contra o banco real.

## 1. Desenvolvimento

### Pré-requisitos

- Node.js **22**, a partir de 22.12, e npm.
- Docker com Compose para o banco, **ou** PostgreSQL 16 já instalado.
- Portas livres: 5173 (frontend), 3000 (backend) e 54329 (banco no Compose).

### Primeira execução

**1. Prepare a configuração.** Se ainda não existir `.env`, copie o exemplo:

```sh
cp -n .env.example .env
```

Gere dois segredos independentes, executando duas vezes:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

No `.env`, substitua `POSTGRES_PASSWORD` e `BOOTSTRAP_SECRET` pelos valores gerados. Não mantenha os placeholders. Configure o nome da instituição e o fuso e ajuste estas linhas existentes:

```dotenv
INSTALLATION_NAME=Minha instituição
INSTALLATION_TIME_ZONE=America/Sao_Paulo
PUBLIC_ORIGIN=http://localhost:5173
COOKIE_SECURE=false
API_HOST=127.0.0.1
API_PORT=3000
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=54329
```

Mantenha `POSTGRES_DB` e `POSTGRES_USER` preenchidos conforme o exemplo. Não duplique chaves no arquivo. A API e o comando de migration carregam o `.env` da raiz; não é necessário criar arquivos de ambiente nas pastas dos workspaces. Nunca versione o `.env`.

**2. Inicie somente o banco.** Não é necessário executar `docker compose build` neste modo:

```sh
docker compose up -d --wait postgres
```

**Alternativa sem Docker:** provisione um banco e usuário no PostgreSQL 16, com permissão para criar a estrutura, e ajuste `POSTGRES_HOST`, `POSTGRES_PORT` (normalmente 5432), `POSTGRES_DB`, `POSTGRES_USER` e `POSTGRES_PASSWORD`. Pule o comando Docker acima. `DATABASE_URL` também é aceita pela API local e, quando definida, prevalece sobre essas variáveis; credenciais na URL precisam de percent-encoding.

**3. Instale as dependências, aplique as migrations e inicie a aplicação:**

```sh
npm ci
npm run db:migrate
npm run dev
```

`npm run dev` mantém dois processos no terminal: API com reinício automático e Vite com atualização do frontend. Acesse **[http://localhost:5173](http://localhost:5173)**. O Vite encaminha `/api` para `127.0.0.1:3000`; você não precisa abrir a porta do backend no navegador para usar o sistema.

Para executar os processos em terminais separados:

```sh
# Terminal 1
npm run dev -w backend
```

```sh
# Terminal 2
npm run dev -w frontend
```

Se mudar a porta da API, ajuste também o destino do proxy ao iniciar o frontend, por exemplo `API_PROXY_URL=http://127.0.0.1:3001 npm run dev -w frontend`. Essa variável deve estar no ambiente do processo Vite; não conte com seu carregamento a partir do `.env` da raiz.

### Testar no celular com ngrok

Com ngrok instalado e autenticado (`ngrok config check`), dependências instaladas e banco já migrado:

```sh
docker compose up -d --wait postgres
npm run dev:tunnel --registry=https://registry.npmmirror.com
```

Pare qualquer `npm run dev` ou ngrok anterior: o script exige as portas **3000, 5173 e 4040** livres. Confirme `sim` no terminal para autorizar a exposição da instalação. Ele inicia ngrok e a aplicação, descobre a URL HTTPS e configura temporariamente `PUBLIC_ORIGIN`, cookies seguros e o host permitido no Vite. **Não modifica `.env`, não instala dependências nem executa migrations.** Usa o banco configurado na instalação, não um banco fictício; prefira contas e turmas PILOT de teste.

Abra a URL exibida **no computador e no celular**. Faça login como professor no computador e como aluno no celular; QR e links gerados utilizarão essa URL. Não use localhost durante esse teste. Permita localização no celular quando solicitada pelo fluxo de confirmação. A localização e o acesso externo ainda dependem do dispositivo/rede.

Use **Ctrl+C** para encerrar o túnel e os processos da aplicação iniciados pelo script. PostgreSQL permanece ativo. Depois, `npm run dev --registry=https://registry.npmmirror.com` volta a usar normalmente o `.env` local. Nunca deixe esse servidor de desenvolvimento público sem necessidade: ngrok transporta o tráfego da instalação, incluindo autenticação e possíveis dados acadêmicos. A inspeção de requisições do ngrok fica desativada.

Se o aviso do ngrok aparecer, confira o endereço antes de selecionar **Visit Site**. Tela branca com falha de certificado em `cdn.ngrok.com` pode ser causada pela rede/VPN; teste outra rede sem desabilitar validação TLS. Após trocar de rede, aguarde reconexão e recarregue; se necessário, encerre e execute o script novamente, usando a URL recém-exibida.

Para execução não interativa, `npm run dev:tunnel --registry=https://registry.npmmirror.com -- --yes` representa autorização explícita de exposição. Regressões do script: `npm run test:tunnel --registry=https://registry.npmmirror.com` (usa executáveis simulados, sem abrir túnel público). Script destinado a Linux/macOS/WSL; não substitui a instalação de produção.

### Criar o primeiro usuário

Na primeira visita, informe nome, e-mail, senha de 12–128 caracteres e o `BOOTSTRAP_SECRET` configurado. Esse processo cria o único **owner** da instalação; depois, faça login com o e-mail e a senha escolhidos.

**Não existe seed obrigatório, usuário padrão ou senha padrão.** Migrations criam a estrutura; o formulário cria a primeira conta. Reexecutar migrations já aplicadas não apaga os registros.

Após criar o owner, deixe `BOOTSTRAP_SECRET=` vazio no `.env` e reinicie `npm run dev`. O segredo é exclusivo da configuração inicial, não é a senha do owner e não serve para recuperar acesso. Mesmo antes de removê-lo, o backend já impede um segundo bootstrap.

### Próximas execuções e parada

Com dependências e migrations já preparadas:

```sh
docker compose up -d --wait postgres
npm run dev
```

Se usar PostgreSQL nativo, execute somente `npm run dev`. Rode `npm ci` novamente quando as dependências mudarem e aplique novas migrations quando necessário no seu banco de desenvolvimento.

Use `Ctrl+C` para parar frontend/backend. Para parar apenas o banco no Compose, preservando os dados:

```sh
docker compose stop postgres
```

## 2. Produção / servidor com Docker Compose

**Atenção ao estágio do projeto:** este é o procedimento de primeira instalação dos builds da **E3**, não uma declaração de prontidão do MVP para uso acadêmico oficial. Há chamada, reabertura e recuperação assistida; SMTP, gestão completa e distribuição pública permanecem nos próximos marcos. Não use essa base como fonte oficial de frequência.

### Pré-requisitos

- Servidor com Docker Engine e Docker Compose, repositório e acesso para obter as imagens/dependências.
- Domínio apontando para o servidor e proxy HTTPS. O exemplo abaixo usa **Caddy instalado no mesmo host**, fora do Docker.
- Portas públicas 80/443 disponíveis para o proxy. Banco e porta 8080 devem permanecer restritos ao loopback.

Node/npm não precisam estar instalados no host para executar a aplicação neste modo: os Dockerfiles compilam os workspaces e os containers executam os builds. Não se utiliza `npm run dev` em produção.

### Configurar uma nova instalação

Em um checkout separado do desenvolvimento, copie `.env.example` para `.env` se ainda não existir:

```sh
cp -n .env.example .env
```

Gere dois segredos independentes com seu gerenciador de senhas ou execute `openssl rand -hex 32` duas vezes. Preencha `POSTGRES_PASSWORD` e `BOOTSTRAP_SECRET` com esses valores. Defina nome/fuso da instituição e ajuste:

```dotenv
WEB_PORT=8080
PUBLIC_ORIGIN=https://presenca.sua-instituicao.com.br
COOKIE_SECURE=true
```

Troque o domínio pelo seu. `PUBLIC_ORIGIN` é a origem exata, sem barra final ou caminho. Não reutilize o `.env` de desenvolvimento. Proteja a leitura do arquivo, por exemplo com `chmod 600 .env` em Linux.

O Compose configura o backend com `NODE_ENV=production`, host interno `postgres` e porta interna 5432. `POSTGRES_PORT=54329` controla a porta publicada no host, não a comunicação entre os containers. O `DATABASE_URL` local não é encaminhado pelo Compose atual.

### Construir, migrar e iniciar

```sh
docker compose build
docker compose up -d --wait postgres
docker compose run --rm migrate
docker compose up -d --wait backend frontend
```

Execute na ordem e **não continue se uma etapa falhar**. `migrate` é um serviço de execução pontual; a API não aplica migrations automaticamente e um simples `docker compose up -d` não substitui a primeira instalação acima.

### Configurar domínio e HTTPS

O frontend do Compose atende somente em `127.0.0.1:8080`, já encaminhando `/api` ao backend interno. O proxy externo deve encaminhar **todo o site**, preservando a mesma origem, para essa porta — não diretamente para a API.

Instale o Caddy conforme as [instruções oficiais](https://caddyserver.com/docs/install). Para uma instalação Linux com o serviço systemd do Caddy, adicione este bloco a `/etc/caddy/Caddyfile`, preservando outros sites existentes:

```caddyfile
presenca.sua-instituicao.com.br {
    reverse_proxy 127.0.0.1:8080
}
```

Use o mesmo domínio de `PUBLIC_ORIGIN`. Valide antes de aplicar:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

Com DNS correto, portas 80/443 acessíveis e armazenamento persistente para seus certificados, o Caddy pode emitir e renovar o HTTPS automaticamente. Consulte [HTTPS automático](https://caddyserver.com/docs/automatic-https) e [operação como serviço](https://caddyserver.com/docs/running). Esse exemplo usa Caddy **no host**: `127.0.0.1:8080` não aponta para o host se o proxy estiver em outro container.

Não libere PostgreSQL na internet nem mude `COOKIE_SECURE` para `false` para contornar problemas de certificado. A API rejeita origem pública sem HTTPS/cookie seguro. Este exemplo de proxy não foi validado com um domínio/certificado público neste ambiente; isso deve ser verificado na instalação de destino.

### Verificar e concluir o bootstrap

```sh
docker compose ps
curl --fail https://presenca.sua-instituicao.com.br/api/health
```

O endpoint deve retornar `status: "ok"` e a versão. Abra o domínio HTTPS e crie o owner conforme a seção de primeiro usuário. Confirme o login, deixe `BOOTSTRAP_SECRET=` vazio no `.env` e atualize o ambiente da API:

```sh
docker compose up -d --force-recreate backend
```

`docker compose restart backend` sozinho não carrega novas variáveis. Nenhum owner ou dado acadêmico é apagado pela recriação do container.

### Testar o Compose completo apenas no computador local

Para inspecionar os builds sem domínio, configure `PUBLIC_ORIGIN=http://localhost:8080` e `COOKIE_SECURE=false`, siga a mesma sequência de build/migration/inicialização e abra [http://localhost:8080](http://localhost:8080). Não precisa de Caddy para esse teste em loopback.

Esse modo não oferece hot reload: mudanças de código exigem rebuild/recriação dos serviços afetados. Evite alternar desenvolvimento e instalação real sobre o mesmo banco.

### Persistência, parada e atualizações

O PostgreSQL usa o volume nomeado `postgres_data` do projeto Compose. Para parar a instalação, preservando esse volume:

```sh
docker compose down
```

Para iniciar novamente uma instalação já migrada:

```sh
docker compose up -d --wait postgres backend frontend
```

**Não adicione `--volumes` / `-v` ao `down` da instalação real:** isso remove o volume do banco. Um volume persistente não substitui backup. Alterar `POSTGRES_PASSWORD` no `.env` não troca automaticamente a senha dentro de um banco já inicializado; mudanças de credenciais precisam de procedimento coordenado.

Os passos acima são de **primeira instalação**, não uma receita de atualização. O procedimento oficial de atualização exige manutenção, bloqueio de escritas, **backup obrigatório antes de qualquer migration**, identificação da versão anterior, verificações e possibilidade de restaurar banco/versão anterior antes de reabrir o serviço. A implementação e validação completas seguem o [plano de entregas](docs/plano-entregas.md); não trate `git pull` seguido de migration como atualização segura da instância real.

## 3. Diagnóstico e testes

| Sintoma | O que conferir |
| --- | --- |
| Docker não responde | Verifique se Docker Engine/Desktop está iniciado. O banco via Compose depende dele. |
| Erro de conexão com banco | Serviço PostgreSQL ativo, host/porta e credenciais; confira se há `DATABASE_URL` sobrescrevendo as variáveis locais. |
| Tabelas inexistentes | Execute a migration antes de iniciar a API. |
| Origem recusada / login não funciona | `PUBLIC_ORIGIN` deve coincidir exatamente com o navegador; `localhost` e `127.0.0.1` são origens diferentes. |
| Cookie não funciona em HTTP local | Use `COOKIE_SECURE=false` apenas em loopback; produção exige HTTPS e `true`. |
| Fuso divergente ao iniciar | O fuso é persistido no banco. Restaurar a configuração correspondente; não altere o fuso esperando reescrever o histórico. |
| Bootstrap indisponível | Confira o segredo inicial; se já existe owner, faça login. Não há segundo bootstrap. |
| Porta 5173 ocupada | Pare o outro processo ou configure explicitamente outra porta e origem; Vite não troca de porta silenciosamente. |

Logs do Compose:

```sh
docker compose logs --tail=100 backend postgres
```

Em desenvolvimento, a API também responde em `http://127.0.0.1:3000/api/health`. Ao compartilhar diagnósticos, não inclua `.env`, senhas, cookies ou o resultado completo de `docker compose config`, que pode expor segredos.

Verificações locais após `npm ci`:

```sh
npm run typecheck --registry=https://registry.npmmirror.com
npm test --registry=https://registry.npmmirror.com
npm run build --registry=https://registry.npmmirror.com
```

`npm test` executa os testes unitários do backend e os testes de unidades/componentes do frontend, sem precisar de PostgreSQL, Docker ou da aplicação ligada. O backend descobre `test/*.unit.test.ts` e mantém `test/unit.test.ts`; o frontend descobre os arquivos de teste pelo Vitest. Use `npm run test -w backend --registry=https://registry.npmmirror.com` ou `npm run test -w frontend --registry=https://registry.npmmirror.com` para executar separadamente. Consulte o [inventário, resultados e limites da revisão de testes](docs/entregas/revisao-testes-unitarios.md).

Os testes abaixo precisam de Docker disponível e criam bancos/containers sintéticos próprios; não exigem que a instalação padrão esteja ligada:

```sh
npm run test:integration --registry=https://registry.npmmirror.com
npm run test:compose --registry=https://registry.npmmirror.com
npx --registry=https://registry.npmmirror.com playwright install chromium
npm run test:browser --registry=https://registry.npmmirror.com
```

Se já houver Chrome instalado, pode usar `PLAYWRIGHT_CHANNEL=chrome npm run test:browser` em vez de instalar Chromium. O teste de navegador utiliza as portas 3105/5175 e percorre preparação, chamada, projeção, confirmação, decisão de pendência e histórico. A geolocalização do teste é sintética pela API de emulação do navegador, não GPS físico. Os scripts limpam somente seus recursos temporários; se o Docker for interrompido, confira o alvo informado antes de qualquer limpeza manual. Consulte as [evidências e pendências da E2](docs/entregas/e2.md).

## Organização

```text
backend/src/       API, configuração, identidade, auditoria e tempo
backend/migrations/ migrations SQL versionadas
backend/test/      testes unitários e integração PostgreSQL
frontend/src/      interface inicial, cliente HTTP e estado efêmero de UI
e2e/               fluxo de navegador e acessibilidade automatizada
scripts/           ambientes isolados e verificação da instalação
docs/              requisitos, plano, decisões e evidências
```

## Licença

Este projeto é disponibilizado sob **AGPL-3.0-only**; consulte [LICENSE](LICENSE). Os exemplos de aplicação da licença no texto padrão não alteram essa escolha para `or-later`. Dependências mantêm seus respectivos termos. A distribuição pública completa e a avaliação de todas as obrigações pertencem à E6; esta base não deve ser apresentada como MVP completo ou validado em sala.
