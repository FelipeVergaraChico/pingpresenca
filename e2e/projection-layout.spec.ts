import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Synthetic projection response: verifies actual CSS/Fullscreen API, not attendance rules.
for (const size of [{ width: 1366, height: 768 }, { width: 1024, height: 600 }, { width: 390, height: 844 }]) {
  test(`Projection fullscreen keeps numeric alternative visible at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route('**/api/attendance/layout/projection', route => route.fulfill({ json: {
      lesson: { id: 'layout', offering: 'Turma de teste', title: 'Aula de demonstração', discipline: 'Programação', mode: 'PILOT' },
      serverNow: new Date().toISOString(), open: true, code: '123456', qrUrl: 'https://example.test/#attendance=layout',
      rotatesAt: new Date(Date.now() + 30000).toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString(),
    } }));
    await page.goto('/#project=layout');
    await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
    await page.getByRole('button', { name: 'Tela cheia', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toBe('projection');
    await expect(page.locator('.attendance-code')).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('img', { name: /QR code/ })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Sair da tela cheia' })).toBeInViewport({ ratio: 1 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/projection-fullscreen-${size.width}.png` });
    // Long content / high zoom must still be reachable, never clipped by fullscreen.
    await page.locator('.projection-heading').evaluate(el => { (el as HTMLElement).style.minHeight = '150vh'; });
    await page.getByRole('button', { name: 'Sair da tela cheia' }).scrollIntoViewIfNeeded();
    expect(await page.locator('.projection').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Sair da tela cheia' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  });
}
