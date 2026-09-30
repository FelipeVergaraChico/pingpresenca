# Revisão dos testes unitários — 30/09/2026

Escopo: conferir e complementar testes da aplicação já implementada (E0–E3, listagem e calendário), antes da demonstração pública. Não implementa demonstração, E4/E5, política de IP nem retenção de auditoria. Requisitos acadêmicos e permissões permanecem inalterados.

## Inventário e lacunas

Antes da revisão, `npm test` executava 17 testes unitários backend e 52 testes frontend em 11 arquivos. Já havia integração com PostgreSQL e testes de navegador; estes não foram reclassificados como unitários.

Foram acrescentados **44 testes backend e 18 frontend**, sem instalar dependências. A descoberta backend agora inclui novos arquivos `*.unit.test.ts` automaticamente, além do legado `unit.test.ts`, sem incluir testes de integração.

| Área | Evidência acrescentada | Relação com aceitação |
| --- | --- | --- |
| Paginação/calendário | Defaults, limites, formatos adulterados, campos desconhecidos, datas impossíveis, ano zero, ano bissexto, ordem de datas e habilitação explícita do calendário | Contratos LIST/CAL; mensagens de campo são recorte automatizado de A83 |
| Guardas de acesso | Conta sem papel, papéis simples/acumulados, ADMIN/OWNER, versões divergentes | R01; A52/A53 apenas quanto à comparação de versão |
| Credenciais | Hash truncado/algoritmo inválido, comparação exata de segredos incluindo espaços/zeros/Unicode | Fundação de identidade; não substitui login/recuperação integrados |
| Desafios/localização | Estabilidade na janela, zeros à esquerda, propósitos separados, resultados/motivos/evidência derivada, política opcional, antimeridiano e antípodas | Recortes A42, A44–A47, A75 e A81 |
| Frequência | Cancelamento, reabertura, primeira abertura, estados sem registro, pendências e separação de modos | Recortes A66/A67/A69/A70 |
| Transações | BEGIN/trabalho/COMMIT, ROLLBACK em falha, falha de commit/rollback/conexão e liberação do cliente | Orquestração de A54; atomicidade real depende do PostgreSQL |
| Cliente HTTP | GET/POST, sessão same-origin, código textual, 204, erros por campo, rede, escrita de resultado incerto sem repetição automática, payload inesperado | Fundação de mensagens e confirmação |
| Atualização e contadores | Polling sem sobreposição automática, desmontagem, troca de recurso, recuperação de erro e contador monotônico | Recortes A72/A79/A81; não certifica autoridade temporal do backend |
| Zustand | Seleções independentes, alternância de visibilidade e reset de estado efêmero | Estado de apresentação, não permissões/credenciais |

Arquivos novos: `backend/test/access.unit.test.ts`, `lesson-list.unit.test.ts`, `transaction.unit.test.ts`; `frontend/src/api.test.ts`, `ui-store.test.ts`, `attendance/useLive.test.tsx`. Ampliação de `backend/test/attendance.unit.test.ts`.

Nota sobre frequência: o helper `frequency` recebe cobertura unitária, mas a consulta paginada atual agrega a frequência em SQL. Os testes do helper **não comprovam o SQL**; o cenário de integração LIST-01 verifica o caminho utilizado pela API e seus totais globais independentes da página.

## Defeito reproduzido e corrigido

Os testes HTTP falharam antes da correção com dois resultados: JSON `null` causava `TypeError`, e `message` como objeto produzia `[object Object]`, aceitando também um código de erro não textual. `frontend/src/api.ts` agora valida o envelope e os tipos, preserva erros válidos por campo e usa mensagem compreensível quando a resposta não segue o contrato. Nenhuma mudança nas regras do backend.

## Execução

Ambiente local: Node 24.18.0; PostgreSQL 16 em containers descartáveis nos testes de integração. Nenhum banco da instalação foi alterado. Os containers/volumes sintéticos de integração foram removidos pelos runners ao término.

| Comando | Resultado |
| --- | --- |
| `npm run test --registry=https://registry.npmmirror.com` | **61 backend + 70 frontend aprovados**, zero falhas; frontend em 14 arquivos |
| `npm run typecheck --registry=https://registry.npmmirror.com` | Aprovado nos dois workspaces |
| `npm run build --registry=https://registry.npmmirror.com` | Aprovado nos dois workspaces |
| `npm run test:integration --registry=https://registry.npmmirror.com` | **47 cenários aprovados**, sem contar testes-pai: E0 10, E1 10, E2 10, E3 8, regressões 9 |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:browser --registry=https://registry.npmmirror.com` | **4 testes aprovados**, fluxo real E0–E3/listagem/calendário e projeção em três resoluções |
| `npm run test:tunnel --registry=https://registry.npmmirror.com` | 2 testes de funções aprovados; 1 teste do lançador não concluiu: portas 3000/5173/4040 ocupadas por processos existentes. Não foram encerrados. Nenhum novo túnel público foi iniciado |

O primeiro acesso ao Docker foi impedido pelo sandbox; a integração foi reexecutada com a permissão necessária e aprovada. A falha do lançador foi investigada com inspeção somente de leitura das portas, sem alterar a instalação.

## Limites

- Não foi calculado percentual de cobertura de linhas/branches. Contagem de testes não significa cobertura de 100% nem ausência de defeitos.
- SQL, persistência, auditoria atômica, expiração, escopo por matrícula e concorrência real continuam dependentes dos testes de integração, que também foram executados.
- Os testes frontend incluem unidades e componentes com rede simulada; não são todos testes de funções puras.
- A suíte de integração inclui carga preliminar E3, não certificação A93/E6. Esta revisão não certifica capacidade da VPS nem Node 22/Compose.
- O teste humano com leitor de tela e o piloto real continuam pendentes. Não foram aprovados por testes automatizados.
- Para repetir o teste completo do lançador, encerrar voluntariamente o dev/ngrok que ocupam suas portas e executar `npm run test:tunnel --registry=https://registry.npmmirror.com`.
