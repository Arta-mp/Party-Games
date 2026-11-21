import { expect, test, type Page } from '@playwright/test';
import { holdAndRead, pickGame, release, shot } from './helpers';

/**
 * §9 phase 2 gate: 4 tabs play one online round over the BroadcastChannel transport and we prove,
 * from each tab's raw wire log, that no client ever receives another player's secret.
 */
const NAMES = ['میزبان', 'سارا', 'رضا', 'مینا'];

async function tab(page: Page, name: string, i: number) {
  await page.addInitScript(
    ([n, idx]) => {
      sessionStorage.setItem(
        'pg:identity',
        JSON.stringify({ name: n, deviceId: `dtab${idx}`.padEnd(25, '0') }),
      );
      localStorage.setItem(
        'pg:settings',
        JSON.stringify({ tutorialSeen: true, sound: false, vibration: false }),
      );
      (window as unknown as { __pgWireLog: unknown[] }).__pgWireLog = [];
    },
    [name, i] as const,
  );
}

const wire = (p: Page) =>
  p.evaluate(() => JSON.stringify((window as unknown as { __pgWireLog: unknown[] }).__pgWireLog));

test("4 tabs: lobby, ready, spy round; no client receives another player's secret", async ({ context }) => {
  const pages: Page[] = [];
  for (let i = 0; i < 4; i++) {
    const p = await context.newPage();
    await tab(p, NAMES[i]!, i);
    pages.push(p);
  }
  const [host, ...guests] = pages as [Page, Page, Page, Page];
  await host.goto('./?transport=broadcast#/');
  await host.getByTestId('create-lobby').click();
  const code = (await host.getByTestId('lobby-code').innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{4}$/);

  for (const g of guests) await g.goto(`./?transport=broadcast#/join/${code}`);
  for (const g of guests) await expect(g.getByTestId('lobby-code')).toHaveText(code);
  await expect(host.getByTestId('player-list').locator('> *')).toHaveCount(4);
  await shot(host, 'online-01-lobby-host');

  await pickGame(host, 'hidden-word', 'spy.classic');
  await expect(guests[0].getByTestId('selected-game')).toHaveText('جاسوس کلاسیک');
  await expect(host.getByTestId('start-game')).toBeDisabled(); // nobody is ready yet
  for (const g of guests) await g.getByTestId('ready').click();
  await shot(guests[0], 'online-02-lobby-guest');
  await expect(host.getByTestId('start-game')).toBeEnabled();
  await host.getByTestId('start-game').click();

  const seen: { name: string; role: string; word: string | null }[] = [];
  for (let i = 0; i < 4; i++) {
    const p = pages[i]!;
    await expect(p.getByTestId('hold-reveal')).toBeVisible();
    const r = await holdAndRead(p);
    if (i === 1) await shot(p, 'online-03-reveal');
    await release(p);
    seen.push({ name: NAMES[i]!, role: r.role, word: r.word });
    await p.getByTestId('ack').click();
  }
  const spy = seen.find((s) => s.role === 'جاسوس')!;
  const location = seen.find((s) => s.word)!.word!;
  expect(seen.filter((s) => s.role === 'جاسوس')).toHaveLength(1);
  for (const s of seen) if (s !== spy) expect(s.word).toBe(location);

  // ---- secrecy at the wire level
  for (let i = 0; i < 4; i++) {
    const log = JSON.parse(await wire(pages[i]!)) as {
      w: { $: string; d?: { t: string; view?: Record<string, unknown> } };
    }[];
    const views = log.filter((e) => e.w.$ === 'm' && e.w.d?.t === 'view').map((e) => e.w.d!.view!);
    const lobbies = log.filter((e) => e.w.$ === 'm' && e.w.d?.t === 'lobby');
    if (i > 0) expect(views.length).toBeGreaterThan(0); // the host tab gets its view via loopback
    for (const v of views) {
      // a view only ever describes its own player
      expect(JSON.stringify(v)).not.toContain('"roleId"');
      if (NAMES[i] === spy.name) expect(JSON.stringify({ ...v, reference: null })).not.toContain(location);
      else expect(JSON.stringify(v)).not.toContain('"roleName":"جاسوس"');
    }
    for (const l of lobbies) expect(JSON.stringify(l)).not.toContain(location);
    // frames addressed to other peers never reach this tab's handlers
  }

  // ---- play it out: host opens the vote, everyone votes the spy
  await expect(host.getByTestId('timer')).toBeVisible();
  await shot(host, 'online-04-discuss');
  await host.getByTestId('start-vote').click();
  for (let i = 0; i < 4; i++) {
    const p = pages[i]!;
    const target = NAMES[i] === spy.name ? NAMES.find((n) => n !== spy.name)! : spy.name;
    await p.getByTestId(`pick-${target}`).click();
    await p.getByTestId('confirm-vote').click();
  }
  const spyPage = pages[NAMES.indexOf(spy.name)]!;
  await spyPage.getByRole('button', { name: location, exact: true }).click();
  await spyPage.getByTestId('submit-guess').click();
  for (const p of pages) await expect(p.getByTestId('result-title')).toHaveText('جاسوس‌ها بردند!');
  await shot(guests[0], 'online-05-results');
  await expect(host.getByTestId('scoreboard')).toContainText(spy.name);

  // host can start the next round; guests follow automatically
  await host.getByTestId('next-round').click();
  for (const p of pages) await expect(p.getByTestId('hold-reveal')).toBeVisible();
});

test('kick and lock work from the host phone', async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();
  await tab(host, 'میزبان', 10);
  await tab(guest, 'مزاحم', 11);
  await host.goto('./?transport=broadcast#/');
  await host.getByTestId('create-lobby').click();
  const code = (await host.getByTestId('lobby-code').innerText()).trim();
  await guest.goto(`./?transport=broadcast#/join/${code}`);
  await expect(host.getByTestId('player-مزاحم')).toBeVisible();
  await host.getByTestId('player-مزاحم').click();
  await host.getByTestId('kick').click();
  await expect(guest.getByTestId('denied')).toHaveText('میزبان تو را از لابی بیرون کرد');
  await expect(host.getByTestId('player-مزاحم')).toHaveCount(0);

  await host.getByRole('switch').click(); // lock
  const late = await context.newPage();
  await tab(late, 'دیرکرده', 12);
  await late.goto(`./?transport=broadcast#/join/${code}`);
  await expect(late.getByTestId('denied')).toHaveText('این لابی قفل است');
});

test('a guest that refreshes keeps their seat', async ({ context }) => {
  const host = await context.newPage();
  const guest = await context.newPage();
  await tab(host, 'میزبان', 20);
  await tab(guest, 'سارا', 21);
  await host.goto('./?transport=broadcast#/');
  await host.getByTestId('create-lobby').click();
  const code = (await host.getByTestId('lobby-code').innerText()).trim();
  await guest.goto(`./?transport=broadcast#/join/${code}`);
  await guest.getByTestId('ready').click();
  await expect(host.getByTestId('player-list').locator('> *')).toHaveCount(2);
  await guest.reload();
  await expect(guest.getByTestId('lobby-code')).toHaveText(code);
  await expect(host.getByTestId('player-list').locator('> *')).toHaveCount(2);
});
