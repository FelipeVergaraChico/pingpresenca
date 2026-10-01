import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('DEMO-04/07: landing pública, professor e aluno por QR em contextos distintos', async ({ page, browser }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Dois pontos de vista');
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/demo-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/demo-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: /Experimentar como professor/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Olá, Professor.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Contas e convites' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Selecionar turma' }).selectOption({ label: 'Turma aberta de demonstração · Piloto' });
  await page.locator('article.lesson-card').filter({ has: page.getByRole('heading', { name: '01 · Sua primeira chamada' }) })
    .getByRole('link', { name: /Gerenciar chamada/ }).click();
  await page.getByRole('button', { name: 'Abrir chamada', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Chamada aberta' })).toBeVisible();
  const lessonId = new URLSearchParams(new URL(page.url()).hash.slice(1)).get('attendance');
  const projection = await (await page.request.get(`/api/attendance/${lessonId}/projection`)).json();
  const studentContext = await browser.newContext();
  try {
    const student = await studentContext.newPage();
    await student.goto(projection.qrUrl);
    await expect(student.getByText(/Você abriu uma chamada por link ou QR/)).toBeVisible();
    await student.getByRole('button', { name: 'Entrar como aluno 1' }).click();
    // QR reception is not presence: the existing flow explicitly validates it first.
    await student.getByRole('button', { name: 'Validar QR ou código' }).click();
    await expect(student.getByRole('button', { name: 'Confirmar minha presença' })).toBeVisible();
    await student.getByRole('button', { name: 'Confirmar minha presença' }).click();
    await expect(student.getByRole('status').filter({ hasText: 'Presença confirmada' })).toBeVisible();
    await expect(student.getByLabel('Aviso de demonstração pública')).toBeVisible();
    expect((await new AxeBuilder({ page: student }).analyze()).violations).toEqual([]);
    await student.getByRole('button', { name: 'Trocar perfil' }).click();
    await expect(student.getByRole('button', { name: 'Entrar como aluno 2' })).toBeVisible();
  } finally { await studentContext.close(); }
});
