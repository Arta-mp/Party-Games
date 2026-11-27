import { describe, expect, it } from 'vitest';
import { Driver, makePlayers } from '@/test/harness';
import { holdem, type HoldemConfig, type HoldemState, type HoldemView } from './holdem';
import { cards } from './poker';

const cfg = (p: Partial<HoldemConfig> = {}): HoldemConfig => ({ ...holdem.defaultConfig, ...p });
const st = (d: Driver) => d.state as HoldemState;

/** edit the live state (tests only): rig stacks, hole cards and the deck */
function rig(d: Driver, patch: (s: HoldemState) => void) {
  const s = structuredClone(st(d));
  patch(s);
  d.runner.state = s;
}

/** seats by role in the current hand */
function seats(d: Driver) {
  const v = d.view('public') as HoldemView;
  const by = (f: (x: HoldemView['seats'][number]) => boolean) => v.seats.find(f)!.id;
  return { btn: by((x) => x.button), sb: by((x) => x.sb), bb: by((x) => x.bb) };
}

/** deck for the board: burn, flop, burn, turn, burn, river */
const boardDeck = (board: string) => {
  const [f1, f2, f3, t, r] = cards(board);
  const burn = cards('2s')[0]!;
  return [burn, f1!, f2!, f3!, burn, t!, burn, r!];
};

const total = (d: Driver) => {
  const s = st(d);
  return (
    Object.values(s.stacks).reduce((a, b) => a + b, 0) +
    (s.phase === 'handOver' || s.phase === 'over'
      ? 0
      : Object.values(s.contributed).reduce((a, b) => a + b, 0))
  );
};

describe('cards.holdem — blinds and order', () => {
  it('3 players: SB and BB post, the button acts first preflop and SB first after the flop', () => {
    const d = new Driver(holdem, makePlayers(3), cfg());
    const { btn, sb, bb } = seats(d);
    expect(new Set([btn, sb, bb]).size).toBe(3);
    const s = st(d);
    expect(s.bets[sb]).toBe(10);
    expect(s.bets[bb]).toBe(20);
    expect(s.stacks[sb]).toBe(990);
    expect(s.toAct).toBe(btn);
    expect(s.board).toEqual([]);
    for (const p of d.ids()) expect(s.hole[p]).toHaveLength(2);
    d.act(btn, { type: 'call' });
    d.act(sb, { type: 'call' });
    // the big blind still has the option
    expect(st(d).street).toBe('preflop');
    expect(st(d).toAct).toBe(bb);
    d.noop(bb, { type: 'call' }); // nothing to call
    d.act(bb, { type: 'check' });
    expect(st(d).street).toBe('flop');
    expect(st(d).board).toHaveLength(3);
    expect(st(d).toAct).toBe(sb);
    expect(total(d)).toBe(3000);
  });

  it('heads-up: the button is the small blind, acts first preflop and last after the flop', () => {
    const d = new Driver(holdem, makePlayers(2), cfg());
    const { btn, sb, bb } = seats(d);
    expect(sb).toBe(btn);
    expect(st(d).toAct).toBe(btn);
    d.act(btn, { type: 'call' });
    d.act(bb, { type: 'check' });
    expect(st(d).street).toBe('flop');
    expect(st(d).toAct).toBe(bb);
  });

  it('out-of-turn actions are ignored', () => {
    const d = new Driver(holdem, makePlayers(3), cfg());
    const { sb } = seats(d);
    d.noop(sb, { type: 'fold' });
  });
});

describe('cards.holdem — betting rules', () => {
  it('no-limit min-raise: a raise must be at least the last raise size', () => {
    const d = new Driver(holdem, makePlayers(3), cfg());
    const { btn, sb, bb } = seats(d);
    d.noop(btn, { type: 'raise', to: 30 }); // min raise to 40
    d.act(btn, { type: 'raise', to: 50 }); // raise by 30
    expect(st(d).minRaise).toBe(30);
    const l = (d.view(sb) as HoldemView).me!.legal!;
    expect(l).toMatchObject({
      canCheck: false,
      toCall: 40,
      canRaise: true,
      minRaiseTo: 80,
      maxRaiseTo: 1000,
    });
    d.noop(sb, { type: 'raise', to: 70 });
    d.act(sb, { type: 'raise', to: 80 });
    d.act(bb, { type: 'fold' });
    d.act(btn, { type: 'call' });
    expect(st(d).street).toBe('flop');
    expect(st(d).contributed).toEqual({ [btn]: 80, [sb]: 80, [bb]: 20 });
    // a new street resets the minimum bet to the big blind
    expect((d.view(sb) as HoldemView).me!.legal).toMatchObject({ canCheck: true, minRaiseTo: 20 });
  });

  it('a short all-in raise does not reopen the betting for players who already acted', () => {
    const d = new Driver(holdem, makePlayers(3), cfg());
    const { btn, sb, bb } = seats(d);
    d.act(btn, { type: 'call' });
    d.act(sb, { type: 'call' });
    d.act(bb, { type: 'check' });
    rig(d, (s) => {
      s.stacks[btn] = 130;
    });
    d.act(sb, { type: 'raise', to: 100 });
    d.act(bb, { type: 'call' });
    d.act(btn, { type: 'allIn' }); // 130: a raise of only 30 (< 100)
    expect(st(d).currentBet).toBe(130);
    for (const p of [sb, bb]) {
      if (st(d).toAct !== p) continue;
      const l = (d.view(p) as HoldemView).me!.legal!;
      expect(l.canRaise).toBe(false);
      expect(l.toCall).toBe(30);
      d.noop(p, { type: 'raise', to: 300 });
      d.act(p, { type: 'allIn' }); // treated as a call
      expect(st(d).stacks[p]).toBeGreaterThan(0);
    }
    d.act(st(d).toAct!, { type: 'call' });
    expect(st(d).street).toBe('turn');
    expect(Object.values(st(d).contributed)).toEqual([150, 150, 150]);
  });

  it('a full raise after a bet reopens the action', () => {
    const d = new Driver(holdem, makePlayers(3), cfg());
    const { btn, sb, bb } = seats(d);
    d.act(btn, { type: 'call' });
    d.act(sb, { type: 'call' });
    d.act(bb, { type: 'check' });
    d.act(sb, { type: 'raise', to: 40 });
    d.act(bb, { type: 'raise', to: 120 });
    d.act(btn, { type: 'fold' });
    expect((d.view(sb) as HoldemView).me!.legal).toMatchObject({ canRaise: true, minRaiseTo: 200 });
  });

  it('folding to one player gives them the whole pot (uncalled bet returned)', () => {
    const d = new Driver(holdem, makePlayers(3), cfg());
    const { btn, sb, bb } = seats(d);
    d.act(btn, { type: 'raise', to: 100 });
    d.act(sb, { type: 'fold' });
    d.act(bb, { type: 'fold' });
    const s = st(d);
    expect(s.phase).toBe('handOver');
    expect(s.stacks[btn]).toBe(1030);
    expect(s.stacks[sb]).toBe(990);
    expect(s.stacks[bb]).toBe(980);
    expect(s.results).toEqual([{ amount: 130, eligible: [btn], winners: [btn], category: null }]);
    // nobody has to show cards
    expect((d.view(sb) as HoldemView).seats.find((x) => x.id === btn)!.cards).toBeNull();
  });
});

describe('cards.holdem — showdown and side pots', () => {
  it('builds a main pot and a side pot and awards each to the best eligible hand', () => {
    const d = new Driver(holdem, makePlayers(3), cfg());
    const { btn, sb, bb } = seats(d);
    rig(d, (s) => {
      s.stacks[btn] = 100;
      s.stacks[sb] = 300; // + 10 posted
      s.hole = { [btn]: cards('Ac Ad'), [sb]: cards('Kc Kd'), [bb]: cards('Qc Qd') };
      s.deck = boardDeck('2c 7d 9h Js 3h');
    });
    d.act(btn, { type: 'allIn' }); // 100
    d.act(sb, { type: 'allIn' }); // 310
    d.act(bb, { type: 'call' }); // 310
    const s = st(d);
    expect(s.board).toEqual(cards('2c 7d 9h Js 3h'));
    expect(s.phase).toBe('handOver');
    expect(s.results).toHaveLength(2);
    expect(s.results![0]).toMatchObject({ amount: 300, winners: [btn], category: 'pair' });
    expect(s.results![0]!.eligible.sort()).toEqual([btn, sb, bb].sort());
    expect(s.results![1]).toMatchObject({ amount: 420, winners: [sb], category: 'pair' });
    expect(s.results![1]!.eligible.sort()).toEqual([sb, bb].sort());
    expect(s.stacks).toEqual({ [btn]: 300, [sb]: 420, [bb]: 1000 - 310 });
    // everyone still in shows their cards; all views agree
    const v = d.view(bb) as HoldemView;
    expect(v.seats.find((x) => x.id === btn)!.cards).toEqual(cards('Ac Ad'));
    expect(v.pot).toBe(720);
  });

  it('a tie splits the pot', () => {
    const d = new Driver(holdem, makePlayers(2), cfg());
    const { btn, bb } = seats(d);
    rig(d, (s) => {
      s.hole = { [btn]: cards('2c 3d'), [bb]: cards('4c 5d') };
      s.deck = boardDeck('As Ks Qs Js Ts');
    });
    d.act(btn, { type: 'call' });
    d.act(bb, { type: 'check' });
    for (let i = 0; i < 3; i++) {
      d.act(bb, { type: 'check' });
      d.act(btn, { type: 'check' });
    }
    expect(st(d).results![0]).toMatchObject({ amount: 40, category: 'straightFlush' });
    expect(st(d).results![0]!.winners.sort()).toEqual([btn, bb].sort());
    expect(st(d).stacks).toEqual({ [btn]: 1000, [bb]: 1000 });
  });

  it('the best five of seven cards wins (kicker matters)', () => {
    const d = new Driver(holdem, makePlayers(2), cfg());
    const { btn, bb } = seats(d);
    rig(d, (s) => {
      s.hole = { [btn]: cards('Ah 9c'), [bb]: cards('Ad Kc') };
      s.deck = boardDeck('As 7d 4h 2s Jc');
    });
    d.act(btn, { type: 'allIn' });
    d.act(bb, { type: 'call' });
    expect(st(d).results![0]!.winners).toEqual([bb]);
    expect(st(d).phase).toBe('over');
    const r = d.result()!;
    expect(r.winners).toEqual([bb]);
    expect(r.title).toMatchObject({ k: 'poker.result' });
  });

  it("an all-in runs the board out and the shown hand's category is visible", () => {
    const d = new Driver(holdem, makePlayers(3), cfg());
    const { btn, sb, bb } = seats(d);
    d.act(btn, { type: 'fold' });
    d.act(sb, { type: 'allIn' });
    d.act(bb, { type: 'call' });
    expect(st(d).board).toHaveLength(5);
    expect(st(d).shown.sort()).toEqual([sb, bb].sort());
    // the folded player's cards are never shown
    expect((d.view(sb) as HoldemView).seats.find((x) => x.id === btn)!.cards).toBeNull();
    expect(['handOver', 'over']).toContain(st(d).phase);
    expect(st(d).results!.reduce((a, r) => a + r.amount, 0)).toBe(2000);
  });
});

describe('cards.holdem — privacy', () => {
  it('hole cards are only in their owner’s view until a showdown', () => {
    const d = new Driver(holdem, makePlayers(4), cfg());
    const s = st(d);
    for (const viewer of d.ids()) {
      const v = d.view(viewer) as HoldemView;
      expect(v.me!.hole).toEqual(s.hole[viewer]);
      for (const seat of v.seats) expect(seat.cards).toEqual(seat.id === viewer ? s.hole[viewer] : null);
      const json = JSON.stringify(v);
      expect(json).not.toContain('"deck"');
      expect(json).not.toContain('"hole":{'); // only "me.hole", never the whole map
    }
    const pub = d.view('public') as HoldemView;
    expect(pub.me).toBeNull();
    for (const seat of pub.seats) expect(seat.cards).toBeNull();
    // the hand category is computed only for the viewer
    expect((d.view('p1') as HoldemView).me!.category).toBeNull(); // no board yet
  });
});

describe('cards.holdem — physical cards (chips only)', () => {
  it('no cards in the state; the dealer confirms each street; the table picks the winner', () => {
    const d = new Driver(holdem, makePlayers(3), cfg({ cards: 'physical' }));
    const { btn, sb, bb } = seats(d);
    expect(st(d).deck).toEqual([]);
    expect(st(d).hole).toEqual({});
    d.act(btn, { type: 'call' });
    d.act(sb, { type: 'call' });
    d.act(bb, { type: 'check' });
    expect(st(d).phase).toBe('dealing');
    expect(st(d).street).toBe('flop');
    expect(st(d).board).toEqual([]);
    d.noop(sb, { type: 'check' });
    d.noop('p2', { type: 'dealt' }); // only the host (dealer) confirms
    d.act('p1', { type: 'dealt' });
    expect(st(d).phase).toBe('betting');
    expect(st(d).toAct).toBe(sb);
    for (const street of ['turn', 'river']) {
      d.act(sb, { type: 'check' });
      d.act(bb, { type: 'check' });
      d.act(btn, { type: 'check' });
      expect(st(d).street).toBe(street);
      d.act('p1', { type: 'dealt' });
    }
    d.act(sb, { type: 'raise', to: 100 });
    d.act(bb, { type: 'call' });
    d.act(btn, { type: 'fold' });
    expect(st(d).phase).toBe('pick');
    expect(st(d).pending).toEqual([
      { amount: 260, eligible: expect.any(Array), winners: [], category: null },
    ]);
    expect(st(d).pending[0]!.eligible.sort()).toEqual([sb, bb].sort());
    d.noop('p2', { type: 'pickWinners', pot: 0, winners: [sb] });
    d.noop('p1', { type: 'pickWinners', pot: 0, winners: [btn] }); // folded: not eligible
    d.act('p1', { type: 'pickWinners', pot: 0, winners: [bb] });
    expect(st(d).phase).toBe('handOver');
    expect(st(d).stacks[bb]).toBe(880 + 260);
    expect(total(d)).toBe(3000);
  });

  it('side pots: uncalled chips go back automatically and split pots share the chips', () => {
    const d = new Driver(holdem, makePlayers(3), cfg({ cards: 'physical' }));
    const { btn, sb, bb } = seats(d);
    rig(d, (s) => {
      s.stacks[btn] = 100;
    });
    d.act(btn, { type: 'allIn' });
    d.act(sb, { type: 'call' });
    d.act(bb, { type: 'call' });
    d.act('p1', { type: 'dealt' });
    d.act(sb, { type: 'raise', to: 200 });
    d.act(bb, { type: 'fold' });
    // only sb can still bet: the board runs out with a "dealt" per street
    expect(st(d).phase).toBe('dealing');
    d.act('p1', { type: 'dealt' });
    expect(st(d).street).toBe('river');
    d.act('p1', { type: 'dealt' });
    const s = st(d);
    expect(s.phase).toBe('pick');
    expect(s.pending).toHaveLength(2);
    expect(s.pending[0]).toMatchObject({ amount: 300, winners: [] });
    expect(s.pending[1]).toEqual({ amount: 200, eligible: [sb], winners: [sb], category: null });
    d.act('p1', { type: 'pickWinners', pot: 0, winners: [btn, sb] });
    expect(st(d).stacks[btn]).toBe(150);
    expect(st(d).stacks[sb]).toBe(1000 - 300 + 150 + 200);
    expect(total(d)).toBe(2100);
  });

  it('pass & play with physical cards: the shared screen drives the betting', () => {
    const d = new Driver(holdem, makePlayers(3), cfg({ cards: 'physical' }), { local: true });
    expect(d.pending()).toEqual([]);
    const pub = d.view('public') as HoldemView;
    expect(pub.me!.legal).toMatchObject({ toCall: 20 });
    d.act('p1', { type: 'call' });
    expect(st(d).toAct).not.toBe(pub.toAct);
  });
});

describe('cards.holdem — pass & play, clock, levels, end', () => {
  it('pass & play with virtual cards: the phone goes to whoever acts', () => {
    const d = new Driver(holdem, makePlayers(3), cfg(), { local: true });
    const { btn, sb } = seats(d);
    expect(d.pending()).toEqual([btn]);
    d.act(btn, { type: 'call' });
    expect(d.pending()).toEqual([sb]);
    expect((d.view('public') as HoldemView).me).toBeNull();
  });

  it('the clock checks when possible, otherwise folds', () => {
    const d = new Driver(holdem, makePlayers(2), cfg({ actionSeconds: 10 }));
    const { btn, bb } = seats(d);
    expect(d.runner.deadline()).toBe(d.now + 10_000);
    d.act(btn, { type: 'call' });
    d.advance(9_000);
    expect(st(d).toAct).toBe(bb);
    d.advance(1_000);
    expect(st(d).lastAction[bb]).toBe('check');
    expect(st(d).street).toBe('flop');
    d.advance(10_000); // bb checks again
    d.act(btn, { type: 'raise', to: 40 });
    d.advance(10_000); // bb must call 40: fold
    expect(st(d).phase).toBe('handOver');
    expect(st(d).stacks[btn]).toBe(1020);
  });

  it('blinds double every N hands and the button moves on', () => {
    const d = new Driver(holdem, makePlayers(3), cfg({ blindLevelHands: 2 }));
    const buttons: string[] = [];
    for (let h = 1; h <= 3; h++) {
      buttons.push(seats(d).btn);
      expect(st(d).sb).toBe(h <= 2 ? 10 : 20);
      expect((d.view('p1') as HoldemView).nextLevelIn).toBe(h === 1 ? 2 : h === 2 ? 1 : 2);
      while (st(d).phase === 'betting') d.act(st(d).toAct!, { type: 'fold' });
      d.noop('p2', { type: 'nextHand' }); // host only
      d.act('p1', { type: 'nextHand' });
    }
    expect(new Set(buttons).size).toBe(3);
    const order = d.ids();
    expect(order.indexOf(buttons[1]!)).toBe((order.indexOf(buttons[0]!) + 1) % 3);
  });

  it('busted players are skipped and the last one with chips wins', () => {
    const d = new Driver(holdem, makePlayers(3), cfg());
    const { btn, sb, bb } = seats(d);
    rig(d, (s) => {
      s.stacks[btn] = 50;
      s.hole = { [btn]: cards('2c 3d'), [sb]: cards('Ac Ad'), [bb]: cards('7c 8d') };
      s.deck = boardDeck('Kh Qs 9h 4s Jc');
    });
    d.act(btn, { type: 'allIn' });
    d.act(sb, { type: 'call' });
    d.act(bb, { type: 'call' });
    // three streets checked down
    for (let i = 0; i < 3; i++) {
      d.act(sb, { type: 'check' });
      d.act(bb, { type: 'check' });
    }
    expect(st(d).stacks[btn]).toBe(0);
    expect(st(d).phase).toBe('handOver');
    d.act('p1', { type: 'nextHand' });
    expect(st(d).inHand).not.toContain(btn);
    expect(st(d).inHand).toHaveLength(2);
    expect((d.view('public') as HoldemView).seats.find((x) => x.id === btn)!.inHand).toBe(false);
  });

  it('ending mid-hand gives back the chips in the pot', () => {
    const d = new Driver(holdem, makePlayers(3), cfg());
    const { btn } = seats(d);
    d.act(btn, { type: 'raise', to: 300 });
    d.noop('p2', { type: 'end' });
    d.act('p1', { type: 'end' });
    expect(st(d).phase).toBe('over');
    expect(Object.values(st(d).stacks)).toEqual([1000, 1000, 1000]);
    expect(d.result()!.winners).toHaveLength(3);
  });

  it('validates 2–10 players', () => {
    expect(holdem.validate!(holdem.defaultConfig, 1)).not.toBeNull();
    expect(holdem.validate!(holdem.defaultConfig, 2)).toBeNull();
    expect(holdem.validate!(holdem.defaultConfig, 10)).toBeNull();
    expect(holdem.validate!(holdem.defaultConfig, 11)).not.toBeNull();
  });
});

describe('cards.holdem — random play keeps every chip', () => {
  // a tiny deterministic generator so the test itself is reproducible
  const lcg = (seed: number) => () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

  for (const mode of ['virtual', 'physical'] as const)
    for (const n of [2, 3, 6]) {
      it(`${mode}, ${n} players: 300 hands of random legal actions`, () => {
        const rnd = lcg(n * 7 + (mode === 'virtual' ? 1 : 2));
        const chips = 500 * n;
        let hands = 0;
        let games = 0;
        while (hands < 300) {
          games++;
          const d = new Driver(
            holdem,
            makePlayers(n),
            cfg({ cards: mode, startingStack: 500, blindLevelHands: 5 }),
            {
              seed: n * 100 + games,
            },
          );
          for (let step = 0; step < 20_000 && st(d).phase !== 'over' && hands < 300; step++) {
            const s = st(d);
            expect(total(d)).toBe(chips);
            if (s.phase === 'betting') {
              const p = s.toAct!;
              const l = (d.view(p) as HoldemView).me!.legal!;
              expect(l.toCall).toBeGreaterThanOrEqual(0);
              const r = rnd();
              if (r < 0.2 && !l.canCheck) d.act(p, { type: 'fold' });
              else if (r < 0.7) d.act(p, { type: l.canCheck ? 'check' : 'call' });
              else if (r < 0.97 && l.canRaise && l.minRaiseTo < l.maxRaiseTo)
                d.act(p, {
                  type: 'raise',
                  to: l.minRaiseTo + Math.floor(rnd() * rnd() * (l.maxRaiseTo - l.minRaiseTo)),
                });
              else d.act(p, { type: 'allIn' });
            } else if (s.phase === 'dealing') d.act('p1', { type: 'dealt' });
            else if (s.phase === 'pick') {
              const i = s.pending.findIndex((x) => !x.winners.length);
              const el = s.pending[i]!.eligible;
              d.act('p1', {
                type: 'pickWinners',
                pot: i,
                winners: rnd() < 0.2 ? el : [el[Math.floor(rnd() * el.length)]!],
              });
            } else if (s.phase === 'handOver') {
              hands++;
              d.act('p1', { type: 'nextHand' });
            }
            for (const v of Object.values(st(d).stacks)) expect(v).toBeGreaterThanOrEqual(0);
            if (mode === 'virtual' && st(d).phase === 'betting')
              expect(st(d).board).toHaveLength({ preflop: 0, flop: 3, turn: 4, river: 5 }[st(d).street]);
            if (mode === 'virtual' && st(d).phase === 'betting') {
              // every card is somewhere exactly once (minus one burn per street)
              const all = [...st(d).board, ...Object.values(st(d).hole).flat(), ...st(d).deck];
              expect(new Set(all).size).toBe(all.length);
              expect(all.length).toBe(52 - { preflop: 0, flop: 1, turn: 2, river: 3 }[st(d).street]);
            }
          }
          if (st(d).phase === 'over') {
            hands++;
            expect(d.result()!.winners).toHaveLength(1);
          }
          expect(total(d)).toBe(chips);
        }
        expect(games).toBeGreaterThan(0);
      });
    }
});
