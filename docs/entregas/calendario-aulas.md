# Calendário opcional de aulas

Melhoria autorizada em 30/09/2026, após a lista paginada. Não implementa recorrência, criação em lote, arrastar/remarcar aulas, nem inicia E4/E5.

## Uso e comportamento

- Alternância **Lista / Calendário** nas próximas aulas e no histórico acadêmico dos docentes/admins. Alunos podem consultar o calendário das próximas aulas elegíveis. Minha frequência mantém sua consulta própria paginada e seus cálculos inalterados.
- Calendário mensal embutido, sem modal nem biblioteca adicional. Navegação por mês anterior/próximo, seleção direta de mês e retorno ao mês atual do servidor.
- Datas do filtro inicializam o mês exibido, quando presentes. Sem datas, o backend determina o mês atual no fuso da instalação. O relógio/fuso do dispositivo não classifica aulas.
- Mesmos filtros de período, modo e situação, mesma separação próximas/passadas. Mudar o mês **não apaga nem amplia os filtros**: aplica a interseção. Aplicar novos filtros limpa a seleção do dia e reinicia o mês a partir do período; voltar à lista mantém os filtros e retorna à página 1.
- Cada aula aparece no dia de seu **início planejado**, inclusive se atravessa a meia-noite. Não duplicar uma ocorrência em vários dias.
- Dias mostram o total de aulas elegíveis e filtradas. Ao selecionar um dia, a lista abaixo apresenta os mesmos detalhes, descrição e ações da lista normal, através do componente compartilhado `LessonRows`.
- Detalhes do dia continuam paginados em 10 itens pelo backend. Um dia com mais de 10 aulas não perde aulas nem tem contagem truncada.
- Dias sem aula não iniciam consulta. Mês vazio e falha de carregamento têm mensagens distintas. Botões rotulados com a data completa e total; seleção por teclado, foco nos detalhes e apresentação responsiva. Testes automatizados não substituem o teste humano com leitor de tela, ainda pendente.

## API

O endpoint existente `GET /api/offerings/:id/lessons` aceita:

- `view=calendar` (padrão permanece `list`);
- `month=AAAA-MM`, opcional, entre `0001-01` e `9999-12`;
- mesmos filtros `scope`, `from`, `to`, `mode` e `status`.

Resposta: `{month, days: [{date, total}]}`. Apenas dias com resultados, no máximo 31 entradas. Contagem agregada no PostgreSQL **depois** da autorização, vigência da matrícula e filtros, usando o mesmo conjunto da lista. Não há carregamento de todas as páginas no frontend, nem lista ilimitada de eventos no mês. Ao selecionar dia, usa-se a consulta paginada existente com `from=to=dia` e os demais filtros preservados.

`/api/attendance/history/:id` continua aceitando somente a visualização de lista; solicitar calendário nesse endpoint responde 400, sem afetar o contrato de frequência. Nenhuma migration, dependência ou configuração nova.

## Validação

- CAL-01, dentro da integração de listagem: contagem mensal, mês padrão do servidor, limite de mês, interseção dos filtros, virada de dia no fuso institucional, matrículas encerradas/rematrículas, professor sem acesso e dia com 11 aulas cuja lista tem duas páginas.
- CAL-02–04, testes de interface: fevereiro bissexto, fronteiras de ano, mês vindo do backend, filtros compartilhados, detalhes/ações reaproveitados, paginação do dia e erro de carregamento.
- CAL-05, navegador com API/PostgreSQL reais: navegação mensal, seleção por teclado, filtros mantidos ao voltar à lista, detalhes, axe e capturas desktop/celular.

Referências de domínio preservadas: A23, A73, A79–A85; cálculos de frequência e operações de chamada permanecem protegidos pelas regressões existentes.

### Resultados executados em 30/09/2026

- `npm run test --registry=https://registry.npmmirror.com`: 17 testes backend e 52 frontend aprovados.
- `npm run test:integration --registry=https://registry.npmmirror.com`: 47 cenários E0–E3/regressões aprovados, sem contar testes-pai; inclui CAL-01 e dia com mais de dez aulas em PostgreSQL 16 isolado.
- `npm run typecheck --registry=https://registry.npmmirror.com` e `npm run build --registry=https://registry.npmmirror.com`: aprovados.
- `PLAYWRIGHT_CHANNEL=chrome npm run test:browser --registry=https://registry.npmmirror.com`: 4 testes aprovados; fluxo real ampliado com CAL-05, 3 regressões de projeção, axe sem violações nos pontos verificados.
- Capturas `test-results/lesson-calendar-desktop.png` e `test-results/lesson-calendar-mobile.png` inspecionadas visualmente. A skill de frontend orientou a preservação da identidade verde/creme, controles sem dependência exclusiva de cor, foco e ajuste responsivo.

Ambiente: Node 24.18.0 local e Chrome; esta melhoria não recertifica a referência Node 22/Compose, capacidade E6 ou acessibilidade por leitor de tela humano. Nenhum dado da instalação foi alterado pelos testes.
