import { expect, test } from '@playwright/test';
import { asUser, holdAndRead, pickGame, release, setupLocal, shot } from './helpers';

const NAMES = ['آرتا', 'سارا', 'رضا', 'مینا'];

test('pass & play: a full 4-player round of classic spy', async ({ page }) => {
  await asUser(page, NAMES[0]!);
  await setupLocal(page, NAMES);
  await pickGame(page, 'hidden-word', 'spy.classic');
  await expect(page.getByTestId('selected-game')).toHaveText('جاسوس کلاسیک');
  await shot(page, 'pp-01-setup');
  await page.getByTestId('local-start').click();

  // reveal: the phone goes around, each player holds the card to see their secret
  const roles: Record<string, { role: string; word: string | null }> = {};
  for (let i = 0; i < NAMES.length; i++) {
    const name = await page.getByTestId('handoff-name').innerText();
    if (i === 0) await shot(page, 'pp-02-handoff');
    await page.getByTestId('handoff-ready').click();
    await expect(page.getByTestId('hold-reveal')).toBeVisible();
    // before holding, the secret is not on screen
    await expect(page.getByTestId('role-card')).toHaveCount(0);
    roles[name] = await holdAndRead(page);
    if (i === 0) await shot(page, 'pp-03-reveal');
    await release(page);
    await expect(page.getByTestId('role-card')).toHaveCount(0);
    await page.getByTestId('ack').click();
  }
  const spies = Object.entries(roles)
    .filter(([, r]) => r.role === 'جاسوس')
    .map(([n]) => n);
  expect(spies).toHaveLength(1);
  const spy = spies[0]!;
  const location = roles[NAMES.find((n) => n !== spy)!]!.word!;
  expect(roles[spy]!.word).toBeNull();
  for (const n of NAMES) if (n !== spy) expect(roles[n]!.word).toBe(location);

  // discussion: shared screen with the timer
  await expect(page.getByTestId('public-view')).toBeVisible();
  await expect(page.getByTestId('timer')).toBeVisible();
  await shot(page, 'pp-04-discuss');
  await page.getByTestId('start-vote').click();

  // secret ballot: each player votes privately; everybody votes for the spy (spy votes for someone else)
  for (let i = 0; i < NAMES.length; i++) {
    const voter = await page.getByTestId('handoff-name').innerText();
    await page.getByTestId('handoff-ready').click();
    const target = voter === spy ? NAMES.find((n) => n !== spy)! : spy;
    await page.getByTestId(`pick-${target}`).click();
    if (i === 0) await shot(page, 'pp-05-vote');
    await page.getByTestId('confirm-vote').click();
  }

  // the caught spy gets one guess
  // (no extra hand-off if the spy cast the last vote and already holds the phone)
  await expect(page.getByTestId('handoff-name').or(page.getByTestId('submit-guess'))).toBeVisible();
  if (await page.getByTestId('handoff-name').isVisible()) {
    await expect(page.getByTestId('handoff-name')).toHaveText(spy);
    await page.getByTestId('handoff-ready').click();
  }
  await expect(page.getByText(`فقط ${spy} نگاه کند`)).toBeVisible();
  await shot(page, 'pp-06-guess');
  // pick an option that is not the location → citizens win
  const options = page.locator('[data-testid="private-view"] .grid button');
  const count = await options.count();
  expect(count).toBeGreaterThanOrEqual(4); // every word of the drawn category
  for (let i = 0; i < count; i++) {
    const txt = (await options.nth(i).innerText()).trim();
    if (txt !== location) {
      await options.nth(i).click();
      break;
    }
  }
  await page.getByTestId('submit-guess').click();

  await expect(page.getByTestId('results')).toBeVisible();
  await expect(page.getByTestId('result-title')).toHaveText('شهروندها بردند!');
  await shot(page, 'pp-07-results');

  // next round keeps the session scoreboard
  await page.getByTestId('next-round').click();
  await expect(page.getByTestId('handoff-name')).toBeVisible();
});

test('pass & play survives a page refresh mid-game', async ({ page }) => {
  await asUser(page, NAMES[0]!);
  await setupLocal(page, NAMES.slice(0, 3));
  await pickGame(page, 'hidden-word', 'spy.classic');
  await page.getByTestId('local-start').click();
  const first = await page.getByTestId('handoff-name').innerText();
  await page.getByTestId('handoff-ready').click();
  await page.getByTestId('ack').click();
  const second = await page.getByTestId('handoff-name').innerText();
  expect(second).not.toBe(first);
  await page.reload();
  await expect(page.getByTestId('handoff-name')).toHaveText(second);
});
