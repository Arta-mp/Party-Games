import { expect, test, type Page } from '@playwright/test';
import { asUser, pickGame, setupLocal, shot } from './helpers';

/** Every mode starts in pass & play on a 390px phone, renders without runtime errors and accepts a first move. */
const GAMES: { id: string; family: string; players: number; step?: (p: Page) => Promise<void> }[] = [
  { id: 'spy.classic', family: 'hidden-word', players: 4 },
  { id: 'spy.roles', family: 'hidden-word', players: 4 },
  { id: 'spy.multi', family: 'hidden-word', players: 6 },
  { id: 'spy.topic', family: 'hidden-word', players: 4 },
  { id: 'spy.infiltrator', family: 'hidden-word', players: 5 },
  { id: 'spy.blank', family: 'hidden-word', players: 6 },
  { id: 'spy.grid', family: 'hidden-word', players: 4 },
  { id: 'spy.insider', family: 'hidden-word', players: 5 },
  { id: 'mafia.moderated', family: 'social-deduction', players: 7 },
  { id: 'mafia.auto', family: 'social-deduction', players: 6 },
  { id: 'mafia.werewolf', family: 'social-deduction', players: 7 },
  { id: 'mafia.onenight', family: 'social-deduction', players: 5 },
  { id: 'word.charades', family: 'word-guess', players: 4, step: (p) => p.getByTestId('wg-start').click() },
  { id: 'word.forbidden', family: 'word-guess', players: 4, step: (p) => p.getByTestId('wg-start').click() },
  { id: 'word.forehead', family: 'word-guess', players: 3, step: (p) => p.getByTestId('wg-start').click() },
  { id: 'word.drawing', family: 'word-guess', players: 3, step: (p) => p.getByTestId('draw-start').click() },
  { id: 'word.unique', family: 'word-guess', players: 4 },
  { id: 'board.codewords', family: 'team-board', players: 4 },
  { id: 'board.duet', family: 'team-board', players: 2 },
  { id: 'board.spectrum', family: 'team-board', players: 4 },
  { id: 'party.esmfamil', family: 'party', players: 3 },
  { id: 'party.liar', family: 'party', players: 3 },
  { id: 'party.mostlikely', family: 'party', players: 3 },
  { id: 'party.truthdare', family: 'party', players: 3, step: (p) => p.getByTestId('spin').click() },
  { id: 'cards.holdem', family: 'card', players: 3 },
];

const NAMES = ['آرتا', 'سارا', 'رضا', 'مینا', 'نیما', 'لیلا', 'امید'];

for (const g of GAMES) {
  test(`starts and renders: ${g.id}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await asUser(page, NAMES[0]!);
    await setupLocal(page, NAMES.slice(0, g.players));
    await pickGame(page, g.family, g.id);
    await page.getByTestId('local-start').click();
    await expect(page).toHaveURL(/#\/local\/play/);
    if (
      await page
        .getByTestId('handoff-ready')
        .isVisible()
        .catch(() => false)
    )
      await page.getByTestId('handoff-ready').click();
    if (g.step) await g.step(page);
    if (
      await page
        .getByTestId('handoff-ready')
        .isVisible()
        .catch(() => false)
    )
      await page.getByTestId('handoff-ready').click();
    await expect(page.locator('main')).not.toBeEmpty();
    await shot(page, `game-${g.id}`);
    expect(errors).toEqual([]);
  });
}
