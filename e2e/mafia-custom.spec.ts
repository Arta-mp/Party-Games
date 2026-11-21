import { expect, test } from '@playwright/test';
import LZString from 'lz-string';
import { asUser, holdAndRead, pickGame, release, setupLocal, shot } from './helpers';

test('role editor: build a custom night role step by step and see it in mafia setup', async ({ page }) => {
  await asUser(page, 'آرتا');
  await page.goto('./#/custom');
  await page.getByTestId('new-role').click();
  await page.getByTestId('role-name-input').fill('ساقی');
  await page.getByTestId('role-next').click(); // → team
  await page.getByTestId('role-next').click(); // → ability
  await page.getByRole('switch', { name: 'اکشن شب دارد' }).click();
  await page.getByRole('radio', { name: 'مسدود کردن' }).click();
  await page.getByTestId('role-next').click(); // → win
  await page.getByTestId('role-next').click(); // → preview
  await expect(page.getByTestId('role-preview')).toContainText('ساقی');
  await expect(page.getByTestId('role-preview')).toContainText('مسدود کردن');
  await shot(page, 'custom-01-role-preview');
  await page.getByTestId('role-save').click();
  await expect(page.locator('[data-testid^="saved-role-"]')).toContainText('ساقی');
  await shot(page, 'custom-02-saved');

  // the custom role is offered in the mafia composition
  await setupLocal(page, ['آرتا', 'سارا', 'رضا', 'مینا', 'نیما', 'لیلا']);
  await page.getByTestId('pick-game').click();
  await page.getByTestId('family-social-deduction').click();
  await page.getByTestId('game-mafia.auto').click();
  await page.getByRole('switch', { name: /ترکیب نقش خودکار/ }).click();
  await expect(page.getByTestId('composition')).toContainText('ساقی');
  await expect(page.getByTestId('balance')).toBeVisible();
  await shot(page, 'custom-03-composition');
  // scenario presets fill the composition (and include scenario-only roles)
  await page.getByTestId('scenario-godfather').click();
  await expect(page.getByTestId('composition')).toContainText('کنستانتین');
  await page.getByLabel('نام سناریوی من').fill('سناریوی ما');
  await page.getByTestId('save-scenario').click();
  await expect(page.getByTestId('scenarios')).toContainText('سناریوی ما');
  await shot(page, 'custom-04-scenario');
});

test('share link imports a role (validated, no install needed)', async ({ page }) => {
  await asUser(page, 'آرتا');
  const role = {
    id: 'oracle',
    nameFa: 'غیب‌گو',
    emoji: '🔮',
    team: 'citizens',
    night: { action: 'reveal', target: 'other', uses: 1 },
  };
  const code = LZString.compressToEncodedURIComponent(
    JSON.stringify({ v: 1, kind: 'ability-role', data: role }),
  );
  await page.goto(`./#/import/${code}`);
  await expect(page.getByTestId('role-preview')).toContainText('غیب‌گو');
  await page.getByTestId('import-save').click();
  await expect(page.getByTestId('saved-role-oracle')).toBeVisible();
  // a broken code is refused
  await page.goto('./#/import/NOT-A-REAL-CODE');
  await expect(page.getByText('این کد یا فایل معتبر نیست')).toBeVisible();
});

test('pass & play mafia (app as moderator): night kill → dawn → vote out the godfather', async ({ page }) => {
  const names = ['آرتا', 'سارا', 'رضا', 'مینا', 'نیما'];
  await asUser(page, names[0]!);
  await setupLocal(page, names);
  await pickGame(page, 'social-deduction', 'mafia.auto');
  await page.getByTestId('local-start').click();

  const roles: Record<string, string> = {};
  for (let i = 0; i < names.length; i++) {
    const n = await page.getByTestId('handoff-name').innerText();
    await page.getByTestId('handoff-ready').click();
    roles[n] = (await holdAndRead(page)).role;
    if (i === 0) await shot(page, 'mafia-01-role');
    await release(page);
    await page.getByTestId('ack').click();
  }
  const mafia = Object.keys(roles).filter((n) => roles[n] === 'پدرخوانده');
  expect(mafia).toHaveLength(1); // 5 players → 1 godfather + doctor + citizens
  const gf = mafia[0]!;

  // night: every player takes the phone; the godfather kills, the rest act/sleep
  let victim = '';
  for (let i = 0; i < names.length; i++) {
    const n = await page.getByTestId('handoff-name').innerText();
    await page.getByTestId('handoff-ready').click();
    if (n === gf) {
      victim = names.find((x) => x !== gf && roles[x] !== 'دکتر')!;
      await page.getByTestId(`pick-${victim}`).click();
      await shot(page, 'mafia-02-night');
      await page.getByTestId('night-act').click();
    } else {
      await page.getByTestId('night-skip').click();
    }
  }
  await expect(page.getByTestId('dawn')).toContainText(victim);
  await shot(page, 'mafia-03-dawn');
  await page.getByTestId('continue').click();
  await page.getByTestId('start-vote').click();
  const alive = names.filter((n) => n !== victim);
  const voteRound = async () => {
    for (let i = 0; i < alive.length; i++) {
      const n = await page.getByTestId('handoff-name').innerText();
      await page.getByTestId('handoff-ready').click();
      if (n === gf) await page.getByTestId('vote-skip').click();
      else {
        await page.getByTestId(`pick-${gf}`).click();
        await page.getByTestId('confirm-vote').click();
      }
    }
  };
  // first vote → the godfather has more than half → defense → final vote
  await voteRound();
  await expect(page.getByTestId('defendants')).toContainText(gf);
  await shot(page, 'mafia-04-defense');
  await page.getByTestId('start-final').click();
  await voteRound();
  await expect(page.getByTestId('result-title')).toHaveText('شهروندها بردند!');
  await shot(page, 'mafia-05-results');
});
