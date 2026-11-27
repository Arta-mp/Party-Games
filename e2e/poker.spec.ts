import { expect, test, type Page } from '@playwright/test';
import { asUser, pickGame, setupLocal, shot } from './helpers';

const NAMES = ['آرتا', 'سارا', 'رضا'];

const visible = (p: Page, id: string) =>
  p
    .getByTestId(id)
    .first()
    .isVisible()
    .catch(() => false);

/** plays passively (check, otherwise call) until the hand is over */
async function playHand(page: Page, opts: { physical?: boolean } = {}) {
  for (let i = 0; i < 60; i++) {
    if (await visible(page, 'hand-results')) return;
    if (await visible(page, 'handoff-ready')) {
      await page.getByTestId('handoff-ready').click();
      continue;
    }
    if (opts.physical && (await visible(page, 'poker-dealt'))) {
      await page.getByTestId('poker-dealt').click();
      continue;
    }
    if (opts.physical && (await visible(page, 'pick'))) {
      await page.getByTestId(`win-${NAMES[1]}`).click();
      await shot(page, 'poker-physical-pick');
      await page.getByTestId('confirm-winners').click();
      continue;
    }
    if (await visible(page, 'poker-check')) await page.getByTestId('poker-check').click();
    else if (await visible(page, 'poker-call')) await page.getByTestId('poker-call').click();
    else await page.waitForTimeout(100);
  }
  throw new Error('hand did not finish');
}

test('pass & play, virtual cards: private hole cards, raise panel, showdown and next hand', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await asUser(page, NAMES[0]!);
  await setupLocal(page, NAMES);
  await pickGame(page, 'card', 'cards.holdem');
  await page.getByTestId('local-start').click();
  await page.getByTestId('handoff-ready').click();
  await expect(page.getByTestId('poker-table')).toBeVisible();
  await expect(page.getByTestId('my-hand').getByTestId('playing-card')).toHaveCount(2);
  await expect(page.getByTestId('board').getByTestId('playing-card')).toHaveCount(0);
  await shot(page, 'poker-01-preflop');

  // open the raise panel and use the presets
  await page.getByTestId('poker-raise').click();
  await expect(page.getByTestId('raise-panel')).toBeVisible();
  await page.getByTestId('preset-pot').click();
  await shot(page, 'poker-02-raise');
  await page.getByTestId('raise-confirm').click();

  await playHand(page);
  await expect(page.getByTestId('hand-results')).toBeVisible();
  await shot(page, 'poker-03-results');
  await page.getByTestId('next-hand').click();
  await page.getByTestId('handoff-ready').click();
  await expect(page.getByText(/دست ۲/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('pass & play, physical cards: chips only, dealer prompts and the table picks the winner', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await asUser(page, NAMES[0]!);
  await setupLocal(page, NAMES);
  await page.getByTestId('pick-game').click();
  await page.getByTestId('family-card').click();
  await page.getByTestId('game-cards.holdem').click();
  await page.getByRole('radio', { name: /ورق واقعی/ }).click();
  await shot(page, 'poker-00-setup');
  await page.getByTestId('confirm-game').click();
  await page.getByTestId('local-start').click();
  // no hand-off: the shared screen drives the chips
  await expect(page.getByTestId('poker-table')).toBeVisible();
  await expect(page.getByTestId('turn-of')).toBeVisible();
  await expect(page.getByTestId('playing-card')).toHaveCount(0);
  await shot(page, 'poker-04-physical');
  // call, call, check → the dealer is asked for the flop
  await page.getByTestId('poker-call').click();
  await page.getByTestId('poker-call').click();
  await page.getByTestId('poker-check').click();
  await expect(page.getByTestId('dealing')).toBeVisible();
  await shot(page, 'poker-05-deal-flop');
  await playHand(page, { physical: true });
  await expect(page.getByTestId('hand-results')).toContainText(NAMES[1]!);
  expect(errors).toEqual([]);
});

test('online, 3 phones: each sees only their own cards and acts on their own phone', async ({ context }) => {
  const pages: Page[] = [];
  for (let i = 0; i < 3; i++) {
    const p = await context.newPage();
    await p.addInitScript(
      ([n, idx]) => {
        sessionStorage.setItem(
          'pg:identity',
          JSON.stringify({ name: n, deviceId: `poker${idx}`.padEnd(25, '0') }),
        );
        localStorage.setItem(
          'pg:settings',
          JSON.stringify({ tutorialSeen: true, sound: false, vibration: false }),
        );
      },
      [NAMES[i]!, i] as const,
    );
    pages.push(p);
  }
  const [host, ...guests] = pages as [Page, Page, Page];
  await host.goto('./?transport=broadcast#/');
  await host.getByTestId('create-lobby').click();
  const code = (await host.getByTestId('lobby-code').innerText()).trim();
  for (const g of guests) await g.goto(`./?transport=broadcast#/join/${code}`);
  await expect(host.getByTestId('player-list').locator('> *')).toHaveCount(3);
  await pickGame(host, 'card', 'cards.holdem');
  for (const g of guests) await g.getByTestId('ready').click();
  await host.getByTestId('start-game').click();

  const hands: string[] = [];
  for (const p of pages) {
    await expect(p.getByTestId('my-hand').getByTestId('playing-card')).toHaveCount(2);
    // other seats show no cards before the showdown
    await expect(p.getByTestId('seats').getByTestId('playing-card')).toHaveCount(0);
    hands.push(
      (
        await p
          .getByTestId('my-hand')
          .getByTestId('playing-card')
          .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
      ).join(),
    );
  }
  expect(new Set(hands).size).toBe(3);
  // exactly one phone has the action buttons
  const withActions = async () => {
    const r: Page[] = [];
    for (const p of pages) if (await visible(p, 'actions')) r.push(p);
    return r;
  };
  await expect.poll(async () => (await withActions()).length).toBe(1);
  await shot(host, 'poker-06-online-host');

  for (let i = 0; i < 40; i++) {
    if (await visible(host, 'hand-results')) break;
    const [p] = await withActions();
    if (!p) {
      await host.waitForTimeout(100);
      continue;
    }
    if (await visible(p, 'poker-check')) await p.getByTestId('poker-check').click();
    else await p.getByTestId('poker-call').click();
    await p.waitForTimeout(150);
  }
  await expect(host.getByTestId('hand-results')).toBeVisible();
  for (const p of pages) await expect(p.getByTestId('board').getByTestId('playing-card')).toHaveCount(5);
  // at the showdown everyone's cards are on the table
  await expect(guests[0].getByTestId('seats').getByTestId('playing-card')).toHaveCount(4);
  await shot(guests[0], 'poker-07-online-showdown');
  await host.getByTestId('next-hand').click();
  await expect(guests[1].getByText(/دست ۲/)).toBeVisible();
});
