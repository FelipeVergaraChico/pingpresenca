# Revalidação após REV-E2-04 — 23/09/2026

## Correções

- `frontend/src/attendance/Settings.tsx`: editor mantém duração, justificativa e versão-base em estado próprio, sem remontagem por polling. Mudança remota exibe valores atuais e preserva o rascunho. Salvar exige revisão explícita antes de adotar a versão nova; o backend continua verificando versão e justificativa. Conflito recebido do servidor também permite atualizar os dados para revisão sem descartar a edição. Falha no refresh após escrita não repete a escrita.
- Diagnóstico promovido para `frontend/src/attendance/Settings.test.tsx`, com quatro testes permanentes: preservação do rascunho, revisão explícita/payload, conflito no servidor e falha de atualização após salvamento. A configuração em `reviews/e2/final.config.ts` aponta para essa suíte.
- `scripts/compose-smoke.mjs`: usa `--env-file /dev/null`, isolando a configuração do teste do `.env` pessoal.
- `.env` local: cinco linhas de tabela Markdown foram convertidas em comentários, preservando seu conteúdo e todas as variáveis existentes. Nenhum valor foi reproduzido na documentação; `docker compose config --quiet` passou. Não houve mudança de credenciais ou operação no banco real.

## Nova verificação

Além da correção, foram conferidos novamente os callbacks de seleção, a separação entre gestão e participação, o histórico por matrícula, as versões de política e a correspondência com o escopo E2. As regressões anteriores continuam incorporadas na suíte. Não foi identificado novo defeito funcional no recorte inspecionado; isso não constitui garantia de ausência de defeitos.

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | Backend e frontend aprovados. |
| `npm test` | 17 testes backend + 37 frontend aprovados. |
| `npm run test:tunnel` | 3 testes aprovados; sem túnel público. |
| `npm run build` | Backend e frontend aprovados. |
| `npm run test:integration` | 10 cenários E0, 10 E1, 9 E2 e 9 regressões backend aprovados. |
| `NPM_REGISTRY=https://registry.npmmirror.com npm run test:compose` | Aprovado com o runner corrigido: Node 22, migrations, bootstrap/login e persistência após recriação. |
| `docker compose config --quiet` | Configuração local válida, sem exibir seus valores. |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:browser` | Reexecução isolada aprovada: fluxo E0/E1/E2 e 13 verificações axe. |

Os comandos npm utilizaram `--registry=https://registry.npmmirror.com`. Banco real não foi migrado, apagado ou usado nas suítes. Recursos sintéticos foram removidos pelos runners; ngrok permaneceu desligado. Host usa Node 24, enquanto o Compose validou Node 22.

### Navegador

A primeira execução junto com os builds/integrações excedeu o limite de cinco segundos ao aguardar o fim do bootstrap: a captura ainda mostrava “Aguarde…”, sem erro de formulário. A repetição isolada passou (fluxo em 44,1 segundos), sem relaxar tempo ou asserções. A concorrência de processos é uma hipótese para a lentidão, não uma causa comprovada. A falha inicial permanece registrada, apesar da reexecução aprovada.

## Status da entrega

REV-E2-01 a REV-E2-04 corrigidos. A validação humana com leitor de tela segue pendente conforme o plano; não foi substituída por DOM/axe nem pelo teste físico de QR relatado pelo mantenedor. A E2 não deve receber aceite integral enquanto esse roteiro não for executado e registrado.

Nenhuma funcionalidade E3 foi iniciada. Próximo marco previsto permanece **E3 — Preparação técnica para o piloto**. Não há nova pendência de código identificada por esta verificação; a ressalva de aceite assistivo permanece explícita.
