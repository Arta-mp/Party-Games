import { expect, test } from '@playwright/test';
import { asUser, pickGame, setupLocal, shot } from './helpers';

test('first run: name screen → tutorial → home; name validation', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'اسمت چیه؟' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByTestId('name-input').fill('ع');
  await expect(page.getByTestId('name-save')).toBeDisabled();
  await page.getByTestId('name-input').fill('آرتا');
  await page.getByTestId('name-save').click();
  await expect(page.getByTestId('tutorial')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.getByTestId('tutorial-next').click();
  await shot(page, 'app-01-tutorial');
  await page.getByTestId('tutorial-next').click();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await expect(page.getByTestId('create-lobby')).toBeVisible();
  await shot(page, 'app-02-home');
  // remembered on reload
  await page.reload();
  await expect(page.getByTestId('me-chip')).toContainText('آرتا');
});

test('settings: light theme and English (LTR)', async ({ page }) => {
  await asUser(page, 'آرتا');
  await page.goto('./#/settings');
  await page.getByRole('radio', { name: /روشن/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await shot(page, 'app-03-settings-en-light');
  await page.goto('./#/');
  await expect(page.getByTestId('create-lobby')).toContainText('Create online lobby');
  await expect(page.getByTestId('game-spy.classic')).toContainText('Classic Spy');
  await shot(page, 'app-04-home-en');
  // settings persist
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('PWA: manifest + service worker; pass & play works offline', async ({ page, context }) => {
  await asUser(page, 'آرتا');
  await page.goto('./');
  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifest).toBeTruthy();
  const m = await (await page.request.get(manifest!)).json();
  expect(m.lang).toBe('fa');
  expect(m.dir).toBe('rtl');
  expect(m.icons.length).toBeGreaterThanOrEqual(2);
  // wait until the service worker controls the page (precached app shell)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // warm the lazy chunks of the pages we use offline
  await page.goto('./#/local');
  await expect(page.getByTestId('local-name')).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await setupLocal(page, ['آرتا', 'سارا', 'رضا']);
  await pickGame(page, 'hidden-word', 'spy.classic');
  await page.getByTestId('local-start').click();
  await expect(page.getByTestId('handoff-name')).toBeVisible();
  await shot(page, 'app-05-offline');
  await context.setOffline(false);
});
