import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('E0–E3: preparation, attendance, reopening, cancellation and recovery through real UI/API', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vamos começar.' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'test-results/e0-desktop.png',
    fullPage: true,
  });
  await page.getByLabel('Seu nome').focus();
  await page.keyboard.type('Pessoa de teste');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('E-mail', { exact: true })).toBeFocused();
  await page.keyboard.type('owner@example.com');
  await page.keyboard.press('Tab');
  await page.keyboard.type('senha-sintetica-longa-123');
  await page.keyboard.press('Tab'); // Show password toggle
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Confirme a senha')).toBeFocused();
  await page.keyboard.type('senha-sintetica-longa-123');
  await page.keyboard.press('Tab');
  await page.keyboard.type('e0-browser-synthetic-secret-never-use-in-production');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Criar conta responsável' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Bom ter você aqui.' })).toBeVisible();
  await page.getByLabel('E-mail', { exact: true }).fill('owner@example.com');
  await page.getByLabel('Senha', { exact: true }).fill('senha-sintetica-longa-123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Pessoa.' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'ping_session')?.httpOnly).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Olá, Pessoa.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/e0-mobile.png', fullPage: true });
  await page.reload();
  await expect(page.getByLabel('Segredo de configuração')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByLabel('E-mail', { exact: true }).fill('owner@example.com');
  await page.getByLabel('Senha', { exact: true }).fill('senha-sintetica-longa-123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Contas e convites', exact: true }).click();
  // E1/A83 regression: server-side validation, not only browser required fields.
  await page.getByLabel('Nome completo', { exact: true }).fill('X');
  await page.getByLabel('E-mail da conta', { exact: true }).fill('invalid-form@example.com');
  await page.getByRole('button', { name: 'Cadastrar conta', exact: true }).click();
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.getByLabel('Nome completo', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Nome completo', { exact: true })).toHaveAccessibleDescription(
    /pelo menos 2 caracteres/,
  );
  await expect(
    page.getByRole('group', { name: 'Papéis', exact: true }),
  ).toHaveAccessibleDescription(/Selecione pelo menos 1/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'test-results/e1-validation.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'test-results/e1-validation-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page
    .getByRole('alert')
    .getByRole('button', { name: /^Nome:/ })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Nome completo', { exact: true })).toBeFocused();
  await expect(page.getByLabel('E-mail da conta', { exact: true })).toHaveValue(
    'invalid-form@example.com',
  );
  async function createAccount(name: string, email: string, role: string) {
    await page.getByLabel('Selecionar conta').selectOption('');
    await page.getByLabel('Nome completo').fill(name);
    await page.getByLabel('E-mail da conta').fill(email);
    await page.getByLabel(role, { exact: true }).check();
    await page.getByRole('button', { name: 'Cadastrar conta', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Gerar link de convite', exact: true }).click();
    return page.getByLabel('Link individual de convite (copie antes de sair)').inputValue();
  }
  const teacherLink = await createAccount('Docente piloto', 'docente@example.com', 'Professor');
  const studentLink = await createAccount('Estudante piloto', 'estudante@example.com', 'Aluno');
  await page.getByRole('button', { name: 'Disciplinas e locais', exact: true }).click();
  await page.getByLabel('Nome da disciplina').fill('Programação I');
  // REV-05: persist using the real API, then fail only the read-side refresh.
  let failRefresh = true;
  await page.route('**/api/catalog', async (route) => {
    if (failRefresh) {
      failRefresh = false;
      await route.abort();
    } else await route.continue();
  });
  let disciplineWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/disciplines')
      disciplineWrites++;
  });
  await page.getByRole('button', { name: 'Criar disciplina', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Alteração salva');
  await expect(page.getByRole('button', { name: 'Criar disciplina', exact: true })).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Atualizar lista' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Selecionar disciplina')).toContainText('Programação I');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(disciplineWrites).toBe(1);
  await expect(
    page.getByLabel('Selecionar disciplina').locator('option').filter({ hasText: 'Programação I' }),
  ).toHaveCount(1);
  await page.unroute('**/api/catalog');
  await page.getByLabel('Nome do local').fill('Sala de demonstração');
  await page.getByLabel('Latitude do local').fill('-23.55');
  await page.getByLabel('Longitude do local').fill('-46.63');
  await page.getByRole('button', { name: 'Criar local', exact: true }).click();
  await expect(page.getByLabel('Selecionar local')).toContainText('Sala de demonstração');
  await page.getByRole('button', { name: 'Turmas e aulas', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Disciplina', exact: true })
    .selectOption({ label: 'Programação I' });
  await page.getByLabel('Nome da turma').fill('Programação I — 2026/2');
  await page.getByLabel('Período letivo').fill('2026/2');
  await page.getByLabel('Turno').fill('Noite');
  await page.getByRole('button', { name: 'Criar turma', exact: true }).click();
  await page.getByLabel('Docente piloto', { exact: true }).check();
  await page.getByRole('button', { name: 'Salvar professores', exact: true }).click();
  await expect(page.getByLabel('Docente piloto', { exact: true })).toBeChecked();
  await page
    .getByRole('combobox', { name: 'Aluno', exact: true })
    .selectOption({ label: 'Estudante piloto · estudante@example.com' });
  await page.getByLabel('Início da matrícula', { exact: true }).fill('2026-09-01T00:00');
  await page.getByRole('button', { name: 'Matricular aluno', exact: true }).click();
  const enrollmentForm = page
    .getByRole('button', { name: 'Matricular aluno', exact: true })
    .locator('..');
  await expect(enrollmentForm.getByRole('status')).toHaveText('Alteração salva.');
  await expect(page.locator('.member').filter({ hasText: 'Estudante piloto' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Matricular aluno', exact: true })).toBeDisabled();
  const teacherContext = await browser.newContext({ timezoneId: 'Asia/Tokyo' }),
    studentContext = await browser.newContext();
  try {
    const teacher = await teacherContext.newPage(),
      student = await studentContext.newPage();
    async function acceptAndLogin(target: typeof page, url: string, email: string) {
      await target.goto(url);
      await expect(
        target.getByText('Convite entregue manualmente.', { exact: false }),
      ).toBeVisible();
      await target.getByLabel('Nova senha', { exact: true }).fill('senha-sintetica-longa-456');
      await target.getByLabel('Confirmar nova senha').fill('senha-sintetica-longa-456');
      await target.getByRole('button', { name: 'Aceitar convite e definir senha' }).focus();
      await target.keyboard.press('Enter');
      await expect(target.getByRole('heading', { name: 'Cadastro concluído.' })).toBeVisible();
      await target.getByRole('link', { name: 'Voltar ao acesso da instalação' }).click();
      await target.getByLabel('E-mail', { exact: true }).fill(email);
      await target.getByLabel('Senha', { exact: true }).fill('senha-sintetica-longa-456');
      await target.getByRole('button', { name: 'Entrar', exact: true }).click();
    }
    await acceptAndLogin(teacher, teacherLink, 'docente@example.com');
    await teacher
      .getByLabel('Selecionar turma')
      .selectOption({ label: 'Programação I — 2026/2 · Piloto' });
    await teacher.getByLabel('Título da aula').fill('Primeiros passos');
    await teacher.getByLabel('Início da aula (America/Sao_Paulo)').fill('2026-09-10T19:00');
    await teacher.getByLabel('Fim da aula (America/Sao_Paulo)').fill('2026-09-10T21:00');
    await teacher.getByRole('combobox', { name: 'Local autorizado', exact: true }).selectOption({
      label: 'Sala de demonstração · localização obrigatória',
    });
    await teacher.getByRole('button', { name: 'Criar aula', exact: true }).click();
    await teacher.getByRole('tab', { name: 'Histórico de aulas' }).click();
    await expect(
      teacher.getByRole('heading', { name: 'Primeiros passos', exact: true }),
    ).toBeVisible();
    await teacher.getByRole('button', { name: 'Elegibilidade de Primeiros passos' }).click();
    await expect(teacher.getByRole('region', { name: 'Prévia de elegibilidade' })).toContainText(
      'Estudante piloto',
    );
    expect((await new AxeBuilder({ page: teacher }).analyze()).violations).toEqual([]);
    await teacher.screenshot({
      path: 'test-results/e1-teacher.png',
      fullPage: true,
    });
    await acceptAndLogin(student, studentLink, 'estudante@example.com');
    await student
      .getByLabel('Selecionar turma')
      .selectOption({ label: 'Programação I — 2026/2 · Piloto' });
    await student.getByRole('tab', { name: 'Minha frequência' }).click();
    await expect(student.getByRole('link', { name: 'Primeiros passos', exact: true })).toBeVisible();
    await expect(student.getByText(/10\/09\/2026, 19:00/)).toBeVisible();
    await expect(student.getByRole('button', { name: 'Criar aula', exact: true })).toHaveCount(0);
    await expect(
      student.getByRole('button', { name: 'Contas e convites', exact: true }),
    ).toHaveCount(0);
    await student.setViewportSize({ width: 390, height: 844 });
    expect(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page: student }).analyze()).violations).toEqual([]);
    await student.screenshot({
      path: 'test-results/e1-student.png',
      fullPage: true,
    });
    await page.screenshot({
      path: 'test-results/e1-admin.png',
      fullPage: true,
    });
    // E2: real API/database and browser geolocation API; only coordinates are synthetic.
    const localTime = (date: Date) =>
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .format(date)
        .replace(' ', 'T');
    await teacher.getByLabel('Título da aula').fill('Chamada demonstrável');
    await teacher.getByRole('tab', { name: 'Próximas aulas' }).click();
    await teacher
      .getByLabel('Início da aula (America/Sao_Paulo)')
      .fill(localTime(new Date(Date.now() - 300000)));
    await teacher
      .getByLabel('Fim da aula (America/Sao_Paulo)')
      .fill(localTime(new Date(Date.now() + 1800000)));
    await teacher.getByRole('button', { name: 'Criar aula', exact: true }).click();
    await teacher.getByRole('heading', { name: 'Chamada demonstrável', exact: true }).waitFor();
    const attendanceLinks = teacher.locator('a[href*="#attendance="]');
    const href = await attendanceLinks.last().getAttribute('href');
    await teacher.goto(href!);
    await teacher.getByRole('button', { name: 'Abrir chamada', exact: true }).focus();
    await teacher.keyboard.press('Enter');
    await expect(teacher.getByRole('status').filter({ hasText: 'Chamada aberta' })).toBeVisible();
    const projection = await teacherContext.newPage();
    await projection.goto(
      (await teacher.getByRole('link', { name: /Abrir tela exclusiva/ }).getAttribute('href'))!,
    );
    await expect(projection.getByRole('img', { name: /QR code/ })).toBeVisible();
    expect(await projection.getByText('Estudante piloto', { exact: true }).count()).toBe(0);
    expect((await new AxeBuilder({ page: projection }).analyze()).violations).toEqual([]);
    await projection.screenshot({
      path: 'test-results/e2-projection.png',
      fullPage: true,
    });
    await studentContext.grantPermissions(['geolocation']);
    await studentContext.setGeolocation({
      latitude: -23.55,
      longitude: -46.63,
      accuracy: 500,
    });
    await student.goto(href!);
    await student
      .getByLabel('Código da chamada')
      .fill((await projection.locator('.attendance-code').innerText()).trim());
    await student.getByRole('button', { name: 'Validar código', exact: true }).click();
    await expect(student.getByRole('button', { name: 'Confirmar minha presença' })).toBeEnabled();
    await expect(student.getByText('Conta conectada:', { exact: false })).toBeVisible();
    expect((await new AxeBuilder({ page: student }).analyze()).violations).toEqual([]);
    await student.getByRole('button', { name: 'Confirmar minha presença' }).focus();
    await student.keyboard.press('Enter');
    await expect(student.getByRole('status').filter({ hasText: 'Pendente' })).toBeVisible();
    await expect(teacher.locator('.attendance-list')).toContainText('Pendente');
    await teacher.getByRole('button', { name: 'Analisar Estudante piloto' }).click();
    await expect(teacher.getByText(/Estado em análise: Pendente/)).toBeVisible();
    await teacher
      .getByLabel('Justificativa da decisão')
      .fill('Presença conferida pessoalmente na demonstração');
    await teacher.getByRole('button', { name: 'Aplicar decisão justificada' }).click();
    await expect(teacher.locator('.attendance-list')).toContainText('Presença confirmada');
    await teacher.getByRole('button', { name: 'Fechar chamada', exact: true }).click();
    await expect(
      teacher.getByRole('status').filter({ hasText: 'Chamada encerrada' }),
    ).toBeVisible();
    await expect(projection.getByRole('img')).toHaveCount(0);
    await teacher.getByText('Auditoria da aula', { exact: true }).click();
    await expect(teacher.getByText('PENDING_DECISION', { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page: teacher }).analyze()).violations).toEqual([]);
    await teacher.screenshot({
      path: 'test-results/e2-teacher.png',
      fullPage: true,
    });
    await expect(student.getByRole('heading', { name: 'Meu registro atual' })).toBeVisible();
    await expect(student.getByText('Presença confirmada · Decisão de pendência')).toBeVisible();
    expect(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await student.getByRole('link', { name: /Voltar à área acadêmica/ }).click();
    await student
      .getByLabel('Selecionar turma')
      .selectOption({ label: 'Programação I — 2026/2 · Piloto' });
    await student.getByRole('tab', { name: 'Minha frequência' }).click();
    await expect(student.getByText(/100\.0%/)).toBeVisible();
    expect((await new AxeBuilder({ page: student }).analyze()).violations).toEqual([]);
    await student.screenshot({
      path: 'test-results/e2-history.png',
      fullPage: true,
    });
    await teacher.getByRole('link', { name: /Voltar à área acadêmica/ }).click();
    await teacher
      .getByLabel('Selecionar turma')
      .selectOption({ label: 'Programação I — 2026/2 · Piloto' });
    await teacher.getByLabel('Título da aula').fill('Confirmação automática');
    await teacher
      .getByLabel('Início da aula (America/Sao_Paulo)')
      .fill(localTime(new Date(Date.now() - 300000)));
    await teacher
      .getByLabel('Fim da aula (America/Sao_Paulo)')
      .fill(localTime(new Date(Date.now() + 1800000)));
    await teacher
      .getByRole('combobox', { name: 'Local autorizado', exact: true })
      .selectOption({ label: 'Sala de demonstração · localização obrigatória' });
    await teacher.getByRole('button', { name: 'Criar aula', exact: true }).click();
    const card = teacher
      .locator('.lesson-card')
      .filter({
        has: teacher.getByRole('heading', { name: 'Confirmação automática', exact: true }),
      });
    const autoHref = await card.locator('a[href*="#attendance="]').getAttribute('href');
    await teacher.goto(autoHref!);
    await teacher.getByRole('button', { name: 'Abrir chamada', exact: true }).click();
    await expect(teacher.getByRole('status').filter({ hasText: 'Chamada aberta' })).toBeVisible();
    const lessonId = new URLSearchParams(autoHref!.split('#')[1]).get('attendance');
    const qrData = await (
      await teacher.request.get(`/api/attendance/${lessonId}/projection`)
    ).json();
    await studentContext.setGeolocation({ latitude: -23.55, longitude: -46.63, accuracy: 5 });
    await student.goto(qrData.qrUrl);
    await student.getByRole('button', { name: 'Validar QR ou código' }).click();
    await student.getByRole('button', { name: 'Confirmar minha presença' }).click();
    await expect(
      student.getByRole('status').filter({ hasText: 'Presença confirmada' }),
    ).toBeVisible();
    await expect(teacher.locator('.attendance-list')).toContainText('Validação automática');
    expect((await new AxeBuilder({ page: student }).analyze()).violations).toEqual([]);
    await student.screenshot({ path: 'test-results/e2-student-confirmed.png', fullPage: true });
    await teacher.getByRole('button', { name: 'Fechar chamada', exact: true }).click();
    await expect(
      teacher.getByRole('status').filter({ hasText: 'Chamada encerrada' }),
    ).toBeVisible();
    await teacher.getByRole('button', { name: 'Reabrir chamada', exact: true }).click();
    await teacher.getByLabel('Justificativa da operação').fill('Aluno presente solicitou nova tentativa');
    await teacher.getByRole('button', { name: 'Confirmar reabertura' }).click();
    await expect(teacher.getByRole('status').filter({ hasText: 'Chamada aberta' })).toBeVisible();
    await expect(teacher.locator('.attendance-list')).toContainText('Validação automática');
    await teacher.getByRole('button', { name: 'Cancelar aula', exact: true }).click();
    await teacher.getByLabel('Justificativa da operação').fill('Encerramento do cenário sintético');
    expect((await new AxeBuilder({ page: teacher }).analyze()).violations).toEqual([]);
    await teacher.getByRole('button', { name: 'Confirmar cancelamento da aula' }).click();
    await expect(teacher.getByRole('status').filter({ hasText: 'Aula cancelada' })).toBeVisible();
    await expect(teacher.getByRole('button', { name: 'Reabrir chamada', exact: true })).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Contas e convites', exact: true }).click();
    await page.getByLabel('Selecionar conta').selectOption({ label: 'Estudante piloto · estudante@example.com' });
    await page.getByLabel('Justificativa da recuperação').fill('Identidade conferida para teste sintético');
    await page.getByRole('button', { name: 'Gerar link de recuperação' }).click();
    const reset = page.getByLabel('Link privado de recuperação');
    await expect(reset).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await student.goto(await reset.inputValue());
    await expect(student.getByRole('heading', { name: 'Recuperar acesso', exact: true })).toBeVisible();
    await student.getByLabel('Nova senha', { exact: true }).fill('nova-senha-sintetica-123');
    await student.getByLabel('Confirmar nova senha').fill('nova-senha-sintetica-123');
    expect((await new AxeBuilder({ page: student }).analyze()).violations).toEqual([]);
    await student.getByRole('button', { name: 'Definir nova senha' }).click();
    await expect(student.getByRole('status').filter({ hasText: 'Todas as sessões anteriores' })).toBeVisible();
    expect((await student.request.get('/api/auth/me')).status()).toBe(401);
    await student.getByRole('link', { name: 'Entrar com a nova senha' }).click();
    await student.getByLabel('E-mail', { exact: true }).fill('estudante@example.com');
    await student.getByLabel('Senha', { exact: true }).fill('nova-senha-sintetica-123');
    await student.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(student.getByRole('heading', { name: 'Olá, Estudante.' })).toBeVisible();
    // LIST-06: real paginated endpoint + responsive list + keyboard tabs.
    const catalog = await (await teacher.request.get('/api/catalog')).json();
    const offerings = await (await teacher.request.get('/api/offerings')).json();
    for (let i = 0; i < 12; i++) {
      const created = await teacher.request.post('/api/lessons', {
        headers: { origin: 'http://localhost:5175' }, data: {
          offeringId: offerings[0].id, locationId: catalog.locations[0].id,
          title: `Aula planejada ${String(i + 1).padStart(2,'0')}`, description: '',
          startsLocal: `2099-01-${String(i + 1).padStart(2,'0')}T19:00`,
          endsLocal: `2099-01-${String(i + 1).padStart(2,'0')}T21:00`, attendanceMode: 'OFFICIAL',
        },
      });
      expect(created.status()).toBe(201);
    }
    await teacher.goto('/');
    await teacher.getByLabel('Selecionar turma').selectOption(offerings[0].id);
    const lessonsPanel = teacher.getByRole('tabpanel');
    await expect(lessonsPanel.locator('.lesson-row')).toHaveCount(10);
    await lessonsPanel.getByRole('button', { name: 'Próxima', exact: true }).click();
    await expect(lessonsPanel.getByRole('navigation')).toContainText('Página 2 de 2');
    await expect(lessonsPanel.locator('.lesson-row')).toHaveCount(4);
    await lessonsPanel.getByLabel('Modo', { exact: true }).selectOption('OFFICIAL');
    await lessonsPanel.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expect(lessonsPanel.getByRole('navigation')).toContainText('12 aula(s) · Página 1 de 2');
    await teacher.getByRole('tab', { name: 'Próximas aulas' }).focus();
    await teacher.keyboard.press('ArrowRight');
    await expect(teacher.getByRole('tab', { name: 'Histórico de aulas' })).toBeFocused();
    await expect(lessonsPanel.getByRole('heading', { name: 'Primeiros passos' })).toBeVisible();
    await teacher.keyboard.press('ArrowLeft');
    await expect(lessonsPanel.locator('.lesson-row')).toHaveCount(10);
    expect((await new AxeBuilder({ page: teacher }).analyze()).violations).toEqual([]);
    expect(await lessonsPanel.locator('.list-filters').evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(260);
    await lessonsPanel.screenshot({ path: 'test-results/lesson-list-desktop.png' });
    await teacher.setViewportSize({ width: 390, height: 844 });
    expect(await teacher.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await lessonsPanel.locator('.list-filters').evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(420);
    expect((await new AxeBuilder({ page: teacher }).analyze()).violations).toEqual([]);
    await teacher.locator('.lesson-tabs').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await teacher.screenshot({ path: 'test-results/lesson-list-mobile.png' });
    // CAL-05: optional month view shares filters, lesson actions and responsive layout.
    await teacher.setViewportSize({ width: 1440, height: 1100 });
    await lessonsPanel.getByLabel('Modo', { exact: true }).selectOption('OFFICIAL');
    await lessonsPanel.getByRole('button', { name: 'Aplicar filtros' }).click();
    await lessonsPanel.getByRole('button', { name: 'Calendário', exact: true }).click();
    await lessonsPanel.getByLabel('Mês', { exact: true }).fill('2099-01');
    const calendar = lessonsPanel.getByRole('region', { name: 'Calendário de aulas', exact: true });
    const day = calendar.getByRole('button', { name: /1 de janeiro de 2099: 1 aula/ }).first();
    await day.focus();
    await teacher.keyboard.press('Enter');
    await expect(calendar.getByRole('heading', { name: 'Aula planejada 01', exact: true })).toBeVisible();
    await expect(calendar.getByRole('link', { name: /Gerenciar chamada/ })).toBeVisible();
    expect((await new AxeBuilder({ page: teacher }).analyze()).violations).toEqual([]);
    await calendar.screenshot({ path: 'test-results/lesson-calendar-desktop.png' });
    await teacher.setViewportSize({ width: 390, height: 844 });
    expect(await teacher.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page: teacher }).analyze()).violations).toEqual([]);
    await calendar.screenshot({ path: 'test-results/lesson-calendar-mobile.png' });
    await lessonsPanel.getByRole('button', { name: 'Lista', exact: true }).click();
    await expect(lessonsPanel.getByLabel('Modo', { exact: true })).toHaveValue('OFFICIAL');
    await expect(lessonsPanel.locator('.lesson-row')).toHaveCount(10);
    await projection.close();
  } finally {
    await teacherContext.close();
    await studentContext.close();
  }
});
