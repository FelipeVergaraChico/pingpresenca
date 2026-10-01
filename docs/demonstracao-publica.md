# D1 — Demonstração pública compartilhada

Decisão de produto autorizada em 30/09/2026. Este modo é uma exceção de demonstração, não cadastro público de instituições nem mudança das permissões de uma instalação regular.

Implementação local `0.4.1-demo`: [evidências e limites D1](entregas/d1-demonstracao-publica.md). Implantação remota pendente.

## Contrato

- Uma instalação dedicada, com banco próprio, `PUBLIC_DEMO=true`, sem owner/admin, senhas públicas, SMTP ou cadastro de visitantes. O banco deve ter nome iniciado em `pingpresenca_demo_` e receber marcador persistido pelo comando de preparação.
- Preparação inicial somente em banco vazio de dados acadêmicos/contas/auditoria. Ligar a variável sobre uma instalação real deve falhar, não convertê-la nem apagar dados. Desligar a variável sobre banco marcado também deve falhar.
- Entrada explícita em perfis fictícios pré-definidos: um professor e três alunos. Sessões HTTP-only individuais; dados acadêmicos e identidades fictícias são compartilhados. Visitantes podem interferir nos mesmos registros; não há isolamento por visitante.
- Turma pré-cadastrada, matrículas anteriores ao início das aulas e duas aulas atuais: uma sem exigência geográfica, outra com local de referência fixo para experimentar rejeição/pendência. Não simular GPS nem declarar presença física garantida. Coordenadas dos dispositivos continuam transitórias.
- Professor pode criar/editar aulas PILOT e operar as chamadas reais da sua turma. Configurações, contas, vínculos, convites, recuperações e bootstrap ficam bloqueados também por requisição direta. Sem administrador público.
- Avisos claros de dados fictícios, visibilidade pública/compartilhada, ausência de validade acadêmica e uso proibido para informações reais. A auditoria identifica o perfil fictício, não a identidade civil do visitante. Caso experimente GPS, os dados derivados de distância/precisão também ficam visíveis aos visitantes; esse aviso aparece antes da entrada e nas áreas autenticadas. As coordenadas exatas continuam não persistidas.
- Ciclo de demonstração de 24 horas a partir da preparação/restauração. Sessões limitadas a no máximo duas horas e ao fim do ciclo. Ao vencer, não permitir novas operações acadêmicas até restauração. Informar prazo na interface.
- Limites persistidos por ciclo: 5.000 operações acadêmicas POST autenticadas, 200 sessões emitidas e 30 vagas de criação de aulas (inclusive as duas iniciais, cancelamentos e criações que falham depois da reserva). Login tem seu limite de sessões separado; logout não consome a cota acadêmica. Limite de requisições adicional no processo; esses valores são parâmetros operacionais revisáveis, não capacidade comprovada.
- Restauração apenas por comando de infraestrutura com confirmação explícita, marcador e prefixo de banco conferidos, API parada e lock exclusivo. Apaga irreversivelmente **somente** os dados descartáveis dessa instalação, inclusive a auditoria fictícia; não é uma política de retenção de registros reais.
- Não restaurar dados durante chamadas em andamento silenciosamente. O prazo é informado; o agendamento operacional deve parar a API antes de executar o comando e só reiniciá-la após sucesso. Se falhar, manter indisponível. O agendamento e Nginx serão configurados na implantação, não por esta etapa local.

## Aceitação adicional

| ID | Verificação |
| --- | --- |
| DEMO-01 | Modo desligado não permite login público; ligar sobre banco regular ou desligar sobre marcado impede operação. Preparação não apaga banco sem marcador. |
| DEMO-02 | Preparação produz apenas perfis sintéticos sem ADMIN/OWNER, matrículas vigentes e aulas PILOT. Entrada em perfil não aceita papel/conta arbitrária nem campos extras. |
| DEMO-03 | Cookies mantêm as proteções normais; origem inválida é recusada; bootstrap, login de senha, recuperação e administração ficam bloqueados mesmo com requisições diretas. |
| DEMO-04 | Professor abre chamada, aluno obtém autorização e confirma explicitamente, professor fecha e aluno consulta histórico usando regras reais; nenhum atalho confirma presença. |
| DEMO-05 | Limites são aplicados pelo backend, inclusive sob concorrência; término do ciclo bloqueia operações e acesso autenticado expirado. |
| DEMO-06 | Reset exige confirmação e API parada; marcador/prefixo inválido falha sem remoção. Reset renova dados, códigos e sessões, preserva migrations e marcador de demonstração. |
| DEMO-07 | Landing e áreas autenticadas identificam ambiente compartilhado/temporário; entrada por QR preserva aula/desafio; navegação por teclado e layout móvel funcionam. |

Critérios anteriores (especialmente A32–A55, A63–A86) continuam aplicáveis nos seus respectivos escopos. D1 não certifica carga da VPS, leitor de tela humano, uso oficial nem multi-tenancy.

## Preparação em instalação separada

O template `demo.env.example` deve ser copiado para `.env.demo`, preenchendo senha própria. Não altere o `.env` da instalação real. Todos os comandos Compose devem usar **o mesmo nome de projeto separado**, `pingpresenca-demo`, e o arquivo de ambiente da demo; isso separa containers, rede e volume. As portas 8087/54339 do template são exemplos, não foram verificadas na VPS.

```sh
docker compose -p pingpresenca-demo --env-file .env.demo build
docker compose -p pingpresenca-demo --env-file .env.demo up -d postgres
docker compose -p pingpresenca-demo --env-file .env.demo run --rm migrate
docker compose -p pingpresenca-demo --env-file .env.demo run --rm migrate node backend/dist/demo/prepare-cli.js
docker compose -p pingpresenca-demo --env-file .env.demo up -d backend frontend
```

A primeira execução acima é para um **banco novo**. Atualizações de uma instalação já usada continuam exigindo manutenção e backup antes de migrations. A migration `005_public_demo.sql` é aditiva: cria uma tabela vazia de controle, não transforma nem apaga instalações regulares.

Para testar a demo localmente por Compose, use em `.env.demo` `PUBLIC_ORIGIN=http://localhost:8087` e `COOKIE_SECURE=false`. No domínio público, manter HTTPS/cookie seguro. Geolocalização em celular exige contexto seguro; localhost no celular aponta para o próprio aparelho.

Sem Docker para a API, exporte as variáveis do banco dedicado e execute `npm run db:migrate --registry=https://registry.npmmirror.com`, depois `npm run demo:prepare --registry=https://registry.npmmirror.com` e `npm run dev --registry=https://registry.npmmirror.com`. Variáveis exportadas prevalecem sobre `.env`; não misture a conexão real. Para Vite local, a origem é `http://localhost:5173` e o cookie não seguro é permitido apenas nesse loopback.

## Restauração destrutiva dos dados fictícios

O operador deve anunciar a janela e parar a API. Abaixo, `&&` é intencional: se parar/restaurar falhar, não reiniciar automaticamente. **Todos os dados acadêmicos, sessões e auditoria fictícia desse banco são descartados**, sem recuperação automática. A nova geração recebe novos UUIDs; links/QR antigos deixam de apontar para aulas existentes. Migrations e identificação da instalação permanecem.

```sh
docker compose -p pingpresenca-demo --env-file .env.demo stop backend &&
docker compose -p pingpresenca-demo --env-file .env.demo run --rm migrate node backend/dist/demo/prepare-cli.js --replace-demo-data &&
docker compose -p pingpresenca-demo --env-file .env.demo up -d backend
```

Sem Compose, parar a API e executar `npm run demo:prepare --registry=https://registry.npmmirror.com -- --replace-demo-data` na configuração dedicada antes de iniciá-la novamente. A API mantém um lock de infraestrutura; o comando recusa reset enquanto houver instância ativa, inclusive em outro processo.

O reset é **operacional, não acionável por visitante**. O ciclo limita acessos por 24 horas; sem executar a restauração, a demo fica indisponível para novas operações. Agendar parada/restauração/inicialização e monitorar falhas na VPS faz parte da implantação pendente. Não está instalado nenhum cron/timer nesta etapa.

## Implantação pendente

- Inspecionar via `ssh vps-pizzaria` diretório `projects`, portas, recursos e configuração Nginx sem interromper outros projetos.
- Confirmar registros DNS do domínio `demopingpresenca.online`, preparar servidor virtual Nginx e certificado HTTPS. Não assumir que comprar o domínio configura DNS.
- Encaminhar para a porta loopback do frontend da demo; banco e API não precisam de portas públicas. O Nginx do container serve React e encaminha `/api` ao backend.
- Ajustar limites HTTP na borda e rotação de logs sem gravar corpos/cookies/tokens. O backend mantém `trustProxy=false`; seu limite de 600 requisições/minuto por origem de conexão pode funcionar como limite agregado atrás do proxy. Não confiar em `X-Forwarded-For` arbitrário para contornar abuso.
- Limites de sessão/operações são persistidos; limite HTTP é por processo. Não foi implementado serviço anti-DDoS nem certificada a capacidade de 4 vCPU/4 GB/40 GB.
- Disponibilizar código-fonte correspondente da versão hospedada, avisos de licença e contato operacional. Não inventar um endereço de repositório público ainda não confirmado.
- Separar completamente a instalação do piloto de dezembro. Não colocar dados reais no banco da demo nem aplicar a ele a política de restauração descartável.
