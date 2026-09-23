# Revisão final solicitada da E2 — 23/09/2026

**Atualização posterior:** REV-E2-04 e o formato do `.env` local foram corrigidos; o runner Compose foi isolado desse arquivo. Consulte [revalidação e status atuais](fechamento-tecnico-e2.md). O restante deste relatório preserva os achados e resultados anteriores à correção.

## Parecer

Os três achados anteriores permanecem corrigidos e suas regressões passaram novamente. O fluxo principal também passou no navegador, e há o relato do mantenedor de leitura de QR/confirmação no celular. **Ainda não declarar a E2 integralmente aceita:** foi reproduzido um novo problema de preservação de rascunho na configuração da chamada e permanece a verificação humana com leitor de tela exigida pelo plano.

Esta revisão não implementou correções nem iniciou E3. Foram acrescentados somente diagnóstico automatizado e documentação. O banco real, `.env` e o túnel público não foram alterados.

## REV-E2-04 — P2: atualização remota apaga formulário de política em edição

Arquivo: `frontend/src/attendance/Settings.tsx:14`.

O formulário utiliza `key={data.version}` com dados atualizados periodicamente por `useLive`. Quando outro administrador salva a política, a próxima consulta traz nova versão e o React desmonta o formulário atual, incluindo duração e justificativa digitadas pelo primeiro administrador. Não há aviso ou confirmação para descartar esse rascunho.

Reprodução automatizada:

1. Política inicial de 10 minutos, versão 1.
2. Administrador A digita 15 minutos e uma justificativa, sem salvar.
3. Simula-se a próxima leitura com 20 minutos, versão 2, salva pelo administrador B.
4. A justificativa de A passa a vazia; o formulário foi recriado com os dados novos.

O teste `reviews/e2/settings-review.test.tsx` afirma preservação do rascunho e **falha** com valor recebido vazio. Executar com `./node_modules/.bin/vitest run --config reviews/e2/final.config.ts`. É diagnóstico separado da suíte normal e permanece vermelho até correção.

Impacto: perda silenciosa de trabalho na interface administrativa entregue na E2. Não foi demonstrada sobrescrita indevida de política no banco; o backend continua verificando versão. Correção recomendada: manter rascunho e versão-base separados dos dados consultados, informar atualização remota e exigir ação consciente para recarregar/revisar antes de salvar. Não basta remover a chave e enviar silenciosamente a versão mais recente.

## Verificações reexecutadas

Comandos npm com `--registry=https://registry.npmmirror.com`, bancos sintéticos e recursos temporários isolados.

| Verificação | Resultado nesta revisão |
| --- | --- |
| Typecheck | Backend e frontend aprovados. |
| Testes unitários | 17 backend + 33 frontend aprovados, incluindo correções REV-E2-01–03. |
| Script do túnel | 3 testes aprovados; ngrok simulado, sem publicação. |
| Build | Backend e frontend aprovados. |
| Integrações | 10 cenários E0 + 10 E1 + 9 E2 + 9 regressões backend aprovados. |
| Navegador Chrome | Fluxo integrado E0/E1/E2 aprovado, com 13 verificações axe. |
| Compose com `.env` desabilitado para o teste | Build Node 22, migrations, bootstrap/login e persistência após recriar containers aprovados; recursos sintéticos removidos. |
| Diagnóstico adicional da política | 1 teste falhou, reproduzindo REV-E2-04. |

### Ambiente Compose

O comando padrão de smoke Compose falhou antes de criar a instalação: o parser do Docker encontrou conteúdo em formato de tabela na linha 34 do `.env` local. Não foram copiados dados/credenciais desse arquivo para este relatório e ele não foi editado. Isso é um impedimento da configuração local, não evidência de regressão da chamada.

O runner do smoke ainda lê implicitamente `.env`, apesar de definir valores sintéticos para o teste. A reexecução com `COMPOSE_DISABLE_ENV_FILE=true NPM_REGISTRY=https://registry.npmmirror.com npm run test:compose --registry=https://registry.npmmirror.com` passou integralmente, sem modificar a instalação. Isso confirma o funcionamento do Compose isolado, mas não corrige o arquivo local. Recomenda-se também isolar permanentemente o runner desse arquivo.

## Limites de aceitação

- Código/QR, autorização, geolocalização conservadora, pendências, decisões, fechamento, frequência e histórico foram revistos no recorte E2; as evidências detalhadas por critério permanecem em `e2.md` e `correcoes-e2.md`.
- A verificação humana com leitor de tela continua pendente. Axe, testes DOM e confirmação física pelo celular não a substituem.
- Concorrência completa sob carga, reabertura, cancelamento e recuperação previstos na E3 não foram tratados como funcionalidades esquecidas da E2 nem implementados agora.
- Não há validação de turma real ou garantia de desempenho derivada do teste individual no celular.
- Não foi possível usar `git status`: esta cópia continua não sendo reconhecida como repositório Git.

Antes do aceite integral: corrigir REV-E2-04, reexecutar sua regressão e registrar o roteiro assistivo humano. Para uso normal de Docker Compose nesta instalação, também é necessário corrigir o formato do `.env` local, preservando seus valores válidos. Próxima entrega continua sendo E3, ainda não iniciada.
