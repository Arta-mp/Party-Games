import { describe, expect, it } from 'vitest';
import { buildPots, cardLabel, cards, evaluate, parseCard, splitPot } from './poker';

const val = (s: string) => evaluate(cards(s));

describe('cards', () => {
  it('parses and labels', () => {
    expect(cardLabel(parseCard('As'))).toBe('A♠');
    expect(cardLabel(parseCard('Th'))).toBe('10♥');
    expect(cardLabel(parseCard('2c'))).toBe('2♣');
    expect(new Set(cards('As Ah Ad Ac')).size).toBe(4);
  });
});

describe('hand evaluator (best 5 of 7)', () => {
  it('recognises every category', () => {
    expect(val('As Ks Qs Js Ts 2d 3c').category).toBe('straightFlush');
    expect(val('9h 9d 9s 9c Kd 2c 3h').category).toBe('quads');
    expect(val('9h 9d 9s Kc Kd 2c 3h').category).toBe('fullHouse');
    expect(val('2h 7h 9h Jh Kh Ad As').category).toBe('flush');
    expect(val('5d 6c 7h 8s 9d Kd Kc').category).toBe('straight');
    expect(val('Qh Qd Qs 2c 7d 9c 4h').category).toBe('trips');
    expect(val('Qh Qd 4s 4c 7d 9c 2h').category).toBe('twoPair');
    expect(val('Qh Qd 4s 3c 7d 9c 2h').category).toBe('pair');
    expect(val('Ah Qd 4s 3c 7d 9c 2h').category).toBe('highCard');
  });
  it('orders categories correctly', () => {
    const order = [
      'Ah Qd 4s 3c 7d 9c 2h',
      'Qh Qd 4s 3c 7d 9c 2h',
      'Qh Qd 4s 4c 7d 9c 2h',
      'Qh Qd Qs 2c 7d 9c 4h',
      '5d 6c 7h 8s 9d Kd Kc',
      '2h 7h 9h Jh Kh Ad As',
      '9h 9d 9s Kc Kd 2c 3h',
      '9h 9d 9s 9c Kd 2c 3h',
      'As Ks Qs Js Ts 2d 3c',
    ].map((h) => val(h).score);
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
  });
  it('wheel A-2-3-4-5 is the lowest straight; steel wheel is a straight flush', () => {
    const wheel = val('Ah 2d 3c 4s 5h Kd Qc');
    expect(wheel.category).toBe('straight');
    expect(val('2d 3c 4s 5h 6h Kd Qc').score).toBeGreaterThan(wheel.score);
    expect(val('As 2s 3s 4s 5s Kd Qc').category).toBe('straightFlush');
    // A-K-Q-J-10 beats K-high straight; no wrap-around Q-K-A-2-3
    expect(val('Ah Kd Qc Js Th 2c 3d').score).toBeGreaterThan(val('Kd Qc Js Th 9h 2c 3d').score);
    expect(val('Qh Kd Ac 2s 3h 8c 9d').category).toBe('highCard');
  });
  it('kickers decide ties; identical best five split', () => {
    expect(val('Ah Ad Kc 7s 4h 3c 2d').score).toBeGreaterThan(val('As Ac Qc 7d 4s 3h 2c').score);
    // two pair: higher second pair wins, then kicker
    expect(val('Ah Ad 9c 9s 4h 3c 2d').score).toBeGreaterThan(val('As Ac 8c 8d Ks 3h 2c').score);
    expect(val('Ah Ad 9c 9s Kh 3c 2d').score).toBeGreaterThan(val('As Ac 9h 9d Qs 3h 2c').score);
    // full house compares trips first
    expect(val('3h 3d 3c Ks Kh 2c 7d').score).toBeLessThan(val('4h 4d 4c 2s 2h 9c 7d').score);
    // board plays: both use the same five → exact tie
    const board = 'As Ks Qs Js Ts';
    expect(val(`${board} 2d 3c`).score).toBe(val(`${board} 4h 5d`).score);
    // flush compares all five cards
    expect(val('Ah Jh 9h 6h 3h 2c 2d').score).toBeGreaterThan(val('Ah Jh 9h 6h 2h Kc Kd').score);
  });
  it('picks the best of the seven (e.g. flush over the straight on board)', () => {
    const v = val('5h 6h 7h 8d 9c Kh 2h');
    expect(v.category).toBe('flush');
    expect(v.best).toHaveLength(5);
  });
});

describe('pots', () => {
  it('main pot + side pots with all-ins and folds', () => {
    // A all-in 50, B all-in 100, C calls 100... D folded after putting 20
    const pots = buildPots({ A: 50, B: 100, C: 100, D: 20 }, new Set(['D']));
    expect(pots).toEqual([
      { amount: 20 * 4 + 30 * 3, eligible: ['A', 'B', 'C'] },
      { amount: 100, eligible: ['B', 'C'] },
    ]);
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(270);
  });
  it('an uncalled bet is a pot with a single eligible player (returned)', () => {
    const pots = buildPots({ A: 200, B: 80 }, []);
    expect(pots).toEqual([
      { amount: 160, eligible: ['A', 'B'] },
      { amount: 120, eligible: ['A'] },
    ]);
  });
  it('folded money above every live stake still has a winner', () => {
    const pots = buildPots({ A: 300, B: 50, C: 50 }, new Set(['A']));
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(400);
    expect(pots.every((p) => p.eligible.length > 0)).toBe(true);
  });
  it('odd chips go to the first winner left of the button', () => {
    expect(splitPot(101, ['B', 'A'], ['A', 'B', 'C'])).toEqual({ A: 51, B: 50 });
    expect(splitPot(100, ['C', 'A', 'B'], ['B', 'C', 'A'])).toEqual({ B: 34, C: 33, A: 33 });
  });
});

describe('exhaustive check', () => {
  it('all 2,598,960 five-card hands fall into the textbook category counts', async () => {
    const { evaluate5 } = await import('./poker');
    const counts: Record<string, number> = {};
    const h = [0, 0, 0, 0, 0];
    for (h[0] = 0; h[0] < 52; h[0]++)
      for (h[1] = h[0] + 1; h[1] < 52; h[1]++)
        for (h[2] = h[1] + 1; h[2] < 52; h[2]++)
          for (h[3] = h[2] + 1; h[3] < 52; h[3]++)
            for (h[4] = h[3] + 1; h[4] < 52; h[4]++) {
              const c = evaluate5(h).category;
              counts[c] = (counts[c] ?? 0) + 1;
            }
    expect(counts).toEqual({
      straightFlush: 40,
      quads: 624,
      fullHouse: 3744,
      flush: 5108,
      straight: 10200,
      trips: 54912,
      twoPair: 123552,
      pair: 1098240,
      highCard: 1302540,
    });
  }, 60_000);
});
