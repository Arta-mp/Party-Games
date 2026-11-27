/**
 * Pure Texas Hold'em helpers: cards, 7-card hand evaluation and side pots.
 * A card is a number 0..51: rank = card % 13 (0 = 2 … 12 = Ace), suit = floor(card / 13).
 */
export type CardId = number;

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['♠', '♥', '♦', '♣'] as const;

export const rankOf = (c: CardId) => c % 13;
export const suitOf = (c: CardId) => Math.floor(c / 13);
export const isRed = (c: CardId) => suitOf(c) === 1 || suitOf(c) === 2;
export const cardLabel = (c: CardId) => `${RANKS[rankOf(c)]}${SUITS[suitOf(c)]}`;

/** parse "As", "10h", "Td", "2c" (handy in tests) */
export function parseCard(s: string): CardId {
  const m = s.trim().match(/^(10|[2-9TJQKA])([shdc♠♥♦♣])$/i);
  if (!m) throw new Error(`bad card ${s}`);
  const r = m[1]!.toUpperCase() === 'T' ? '10' : m[1]!.toUpperCase();
  const suit = { s: 0, '♠': 0, h: 1, '♥': 1, d: 2, '♦': 2, c: 3, '♣': 3 }[m[2]!.toLowerCase() as 's'];
  return suit * 13 + RANKS.indexOf(r as (typeof RANKS)[number]);
}
export const cards = (s: string) => s.split(/\s+/).filter(Boolean).map(parseCard);

export const FULL_DECK: CardId[] = Array.from({ length: 52 }, (_, i) => i);

// ------------------------------------------------------------------ evaluation

export const CATEGORIES = [
  'highCard',
  'pair',
  'twoPair',
  'trips',
  'straight',
  'flush',
  'fullHouse',
  'quads',
  'straightFlush',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface HandValue {
  /** comparable score: higher is better, equal = split */
  score: number;
  category: Category;
  /** the five cards that make the hand */
  best: CardId[];
}

/** top rank of a straight in these ranks (6-high = 4 … A-high = 12, wheel A-2-3-4-5 = 3), or -1 */
function straightTop(ranks: Set<number>): number {
  for (let top = 12; top >= 4; top--) if ([0, 1, 2, 3, 4].every((k) => ranks.has(top - k))) return top;
  if ([12, 0, 1, 2, 3].every((r) => ranks.has(r))) return 3;
  return -1;
}

function encode(cat: number, kickers: number[]): number {
  let v = cat;
  for (let i = 0; i < 5; i++) v = v * 13 + (kickers[i] ?? 0);
  return v;
}

/** value of exactly five cards */
export function evaluate5(hand: CardId[]): HandValue {
  const ranks = hand.map(rankOf).sort((a, b) => b - a);
  const flush = hand.every((c) => suitOf(c) === suitOf(hand[0]!));
  const set = new Set(ranks);
  const top = set.size === 5 ? straightTop(set) : -1;
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // groups sorted by size, then rank
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroups = groups.map(([r]) => r);
  let cat: number;
  let kick: number[];
  if (top >= 0 && flush) [cat, kick] = [8, [top]];
  else if (groups[0]![1] === 4) [cat, kick] = [7, byGroups];
  else if (groups[0]![1] === 3 && groups[1]![1] === 2) [cat, kick] = [6, byGroups];
  else if (flush) [cat, kick] = [5, ranks];
  else if (top >= 0) [cat, kick] = [4, [top]];
  else if (groups[0]![1] === 3) [cat, kick] = [3, byGroups];
  else if (groups[0]![1] === 2 && groups[1]![1] === 2) [cat, kick] = [2, byGroups];
  else if (groups[0]![1] === 2) [cat, kick] = [1, byGroups];
  else [cat, kick] = [0, ranks];
  return { score: encode(cat, kick), category: CATEGORIES[cat]!, best: hand };
}

function* combos5(arr: CardId[], start = 0, picked: CardId[] = []): Generator<CardId[]> {
  if (picked.length === 5) {
    yield picked;
    return;
  }
  for (let i = start; i <= arr.length - (5 - picked.length); i++)
    yield* combos5(arr, i + 1, [...picked, arr[i]!]);
}

/** best five-card hand out of 5–7 cards */
export function evaluate(cardsIn: CardId[]): HandValue {
  if (cardsIn.length < 5) throw new Error('need at least 5 cards');
  let best: HandValue | null = null;
  for (const hand of combos5(cardsIn)) {
    const v = evaluate5(hand);
    if (!best || v.score > best.score) best = v;
  }
  return best!;
}

// ------------------------------------------------------------------ pots

export interface Pot {
  amount: number;
  /** players who can win it (not folded and contributed at least this level) */
  eligible: string[];
}

/**
 * Splits total contributions into a main pot and side pots.
 * Folded players' chips stay in the pots but they can't win them.
 * A pot with a single eligible player is an uncalled bet and simply goes back to them.
 */
export function buildPots(contributed: Record<string, number>, folded: Set<string> | string[]): Pot[] {
  const foldedSet = folded instanceof Set ? folded : new Set(folded);
  const levels = [...new Set(Object.values(contributed).filter((v) => v > 0))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const v of Object.values(contributed)) amount += Math.max(0, Math.min(v, level) - prev);
    const eligible = Object.keys(contributed).filter((p) => !foldedSet.has(p) && contributed[p]! >= level);
    if (amount > 0) {
      const last = pots[pots.length - 1];
      // merge consecutive pots with the same eligible players
      if (last && last.eligible.join() === eligible.join()) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = level;
  }
  // contributions only from folded players above every live player's level go to the last live pot
  return pots
    .filter((p) => p.amount > 0)
    .map((p, i, all) => (p.eligible.length ? p : { ...p, eligible: all[i - 1]?.eligible ?? [] }));
}

/**
 * Splits `amount` between winners; odd chips go one by one to the winners closest
 * to the left of the button (`order` = seats starting left of the button).
 */
export function splitPot(amount: number, winners: string[], order: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!winners.length) return out;
  const share = Math.floor(amount / winners.length);
  let rest = amount - share * winners.length;
  const sorted = [...winners].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const w of sorted) {
    out[w] = share + (rest > 0 ? 1 : 0);
    if (rest > 0) rest--;
  }
  return out;
}
