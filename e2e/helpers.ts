import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

export const SHOTS = 'screenshots';
mkdirSync(SHOTS, { recursive: true });

/** Skip onboarding: preset a username and mark the tutorial as seen. */
export async function asUser(page: Page, name: string, extra: Record<string, unknown> = {}) {
  await page.addInitScript(
    ([n, e]) => {
      if (!localStorage.getItem('pg:identity')) {
        localStorage.setItem('pg:identity', JSON.stringify({ name: n, deviceId: 'd' + Math.random().toString(16).slice(2).padEnd(24, '0').slice(0, 24) }));
      }
      localStorage.setItem('pg:settings', JSON.stringify({ tutorialSeen: true, sound: false, vibration: false, ...(e as object) }));
    },
    [name, extra] as const,
  );
}

export async function shot(page: Page, name: string) {
  await page.waitForTimeout(350); // let enter animations finish
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Press-and-hold the role card and return its text, then release. */
export async function holdAndRead(page: Page): Promise<{ role: string; word: string | null; text: string }> {
  const card = page.getByTestId('hold-reveal');
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  const text = await page.getByTestId('role-card').innerText();
  const role = (await page.getByTestId('role-name').count()) ? await page.getByTestId('role-name').innerText() : '';
  const word = (await page.getByTestId('secret-word').count()) ? await page.getByTestId('secret-word').innerText() : null;
  return { role, word, text };
}

export async function release(page: Page) {
  await page.mouse.up();
}

export async function newPhone(browser: Browser, name: string, extra: Record<string, unknown> = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await asUser(page, name, extra);
  return { ctx, page };
}

export async function pickGame(page: Page, family: string, gameId: string) {
  await page.getByTestId('pick-game').click();
  const fam = page.getByTestId(`family-${family}`);
  if ((await fam.getAttribute('aria-expanded')) !== 'true') await fam.click();
  await page.getByTestId(`game-${gameId}`).click();
  await page.getByTestId('confirm-game').click();
  await expect(page.getByTestId('confirm-game')).toBeHidden();
}

export async function setupLocal(page: Page, names: string[]) {
  await page.goto('./#/local');
  for (const n of names.slice(1)) {
    await page.getByTestId('local-name').fill(n);
    await page.getByTestId('local-add').click();
  }
}
