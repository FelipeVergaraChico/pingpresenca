# D1 — Desenvolvimento da demonstração pública

Versão `0.4.1-demo` · 30/09/2026. Desenvolvimento local; **não implantado** na VPS. O domínio confirmado é `demopingpresenca.online`.

## Entregue

- Landing responsiva, entrada sem senha em professor e três alunos fictícios, instruções para usar dois dispositivos/contextos e continuidade do link de QR após escolher o perfil.
- Aviso persistente de ambiente compartilhado, dados descartáveis e ausência de validade acadêmica; informação explícita sobre visibilidade dos dados derivados quando se testa GPS. Projeção também identifica demonstração.
- Instalação marcada e descartável, separada da instalação regular. `PUBLIC_DEMO=false` por padrão; modo demo exige prefixo `pingpresenca_demo_`, ausência de bootstrap e marcador preparado offline. Não há owner/admin público.
- Seed de turma, matrículas e duas aulas PILOT atuais: uma sem GPS e outra com referência fixa para experimentar a política de localização. Não foi acrescentado bypass de validação de presença.
- Allowlist de escritas no backend, bloqueio de gestão de contas/recuperação/convites/configuração/bootstrap, recusa de aula OFFICIAL, cookies normais e validação de origem.
- Cotas persistidas e atômicas de operações, sessões e criação de aulas; limite HTTP adicional. Sessões expiram em no máximo duas horas e nunca além do ciclo de 24 horas, com prazo calculado diretamente pelo PostgreSQL.
- Comando `demo:prepare`, reset explícito `--replace-demo-data`, inventário fechado de tabelas descartáveis, sem CASCADE. Marker/prefixo são verificados e API ativa impede restauração por lock de infraestrutura. Uma conexão dedicada por API mantém essa barreira também no modo regular; não usa um cliente reservado do pool de requisições.
- Migration aditiva `005_public_demo.sql`, template `demo.env.example`, integração com Compose e procedimento de operação. Não altera migrations anteriores nem o mecanismo append-only da auditoria regular.

Contrato e comandos: [demonstração pública](../demonstracao-publica.md). O plano, a especificação e a aceitação registram a exceção de dados sintéticos, sem reduzir requisitos de instalações regulares.

## Arquivos principais

- Backend: `backend/src/demo/{service,routes,prepare-cli}.ts`, `config.ts`, `app.ts`, migration `005_public_demo.sql`.
- Interface: `frontend/src/Demo.tsx`, integração em `App.tsx`, aviso de projeção e estilos em `styles.css`.
- Testes: `backend/test/demo.unit.test.ts`, `demo.integration.test.ts`, `frontend/src/Demo.test.tsx`, `e2e/demo.spec.ts`; runners isolados ampliados para a demo.
- Operação: `demo.env.example`, `compose.yaml`, scripts npm e documentação.

## Evidências

| Comando | Resultado |
| --- | --- |
| `npm run test --registry=https://registry.npmmirror.com` | 63 unitários backend e 76 testes frontend aprovados |
| `npm run test:integration --registry=https://registry.npmmirror.com` | 47 cenários E0–E3/regressões aprovados, sem contar testes-pai |
| `npm run test:demo:integration --registry=https://registry.npmmirror.com` | 6 cenários DEMO-01–06 aprovados, sem contar teste-pai |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:browser --registry=https://registry.npmmirror.com` | 4 testes regulares aprovados: fluxo E0–E3 e projeção em três resoluções |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:demo:browser --registry=https://registry.npmmirror.com` | Fluxo da demo aprovado com professor/aluno em contextos distintos, QR e confirmação explícita, teclado, viewport móvel e axe |
| `npm run typecheck --registry=https://registry.npmmirror.com` | Ambos os workspaces aprovados |
| `npm run build --registry=https://registry.npmmirror.com` | Ambos os workspaces aprovados |
| `docker compose -p pingpresenca-demo --env-file demo.env.example config --quiet` | Configuração válida; não inicia containers nem comprova implantação |
| `git diff --check` | Sem erros de whitespace |

Na validação visual, os rótulos herdavam uma cor destinada a fundo escuro: o axe identificou contraste insuficiente, que foi corrigido para a landing clara. Desktop e celular foram inspecionados por capturas reais. A skill de frontend orientou preservação da identidade verde/creme, hierarquia, foco e controles responsivos. Testes DOM e axe não substituem leitor de tela humano.

Ambiente: Node 24.18.0 local, PostgreSQL 16 descartável e Chrome. Integrações executadas com acesso autorizado ao Docker/IPC após restrição do sandbox. Dados e recursos sintéticos dos runners foram descartados ao finalizar; nenhuma migration/reset foi executada no banco de desenvolvimento do usuário. A carga preliminar incluída no runner E3 não certifica desempenho desta VPS; houve outras verificações simultâneas.

## Aceitação e limites

- DEMO-01–06: verificações PostgreSQL/API, incluindo modo regular sem login público, recusa de preparo sobre dados sem marcador, bloqueio com API regular/demo ativa, ausência de privilégios públicos, origem, cookie Secure/HttpOnly/SameSite, ciclo, concorrência da cota e revogação de sessões por reset.
- DEMO-07: componentes e navegador; landing sem formulário de dados pessoais, informação de compartilhamento, expiração/erros, teclado, QR preservado e transição para a chamada existente.
- Geolocalização, decisões, auditoria e frequência reutilizam as regras existentes; os cenários A permanecem cobertos nos recortes das entregas anteriores, sem declaração de aprovação integral do MVP.
- A API fica indisponível para novas operações de demo quando o ciclo/cotas terminam até restauração. **Agendamento automático ainda precisa ser instalado na VPS**, junto da implantação. Não há botão de reset público.
- Perfis e registros são compartilhados; outro visitante pode interferir. Não é multi-tenancy, não há privacidade por visitante e não é apropriado para dados reais/piloto oficial.
- VPS, DNS, HTTPS, Nginx, monitoramento, rotação de logs, código-fonte correspondente hospedado e capacidade ainda precisam da etapa de implantação/verificação. Nenhum acesso SSH ou alteração remota foi feito nesta entrega.
- O teste humano com leitor de tela, E4 real, E5 completa e certificação E6 continuam pendentes.

## Próximo passo

Inspecionar somente leitura a VPS `vps-pizzaria`, diretório `projects` e Nginx existente; definir portas/limites sem colidir com os projetos em uso; então implantar uma instalação dedicada em `demopingpresenca.online`. Não ativar a flag no banco atual.
