import { z } from 'zod';
import type { Rng } from '@/core/engine/rng';
import {
  clone,
  type GameModule,
  type GameResult,
  type Msg,
  type Player,
  type PlayerId,
} from '@/core/engine/types';
import { META } from '../meta';
import { HoldemPlay, HoldemSetup } from './holdem-ui';
import { buildPots, evaluate, FULL_DECK, splitPot, type Category, type CardId } from './poker';

/**
 * «پوکر تگزاس هولدم» (no-limit). Two ways to play:
 * - virtual: the app shuffles, deals hole cards privately, deals the board and judges the showdown;
 * - physical: real cards on the table, the app is only the chips: blinds, betting, pots, side pots,
 *   and at showdown the table picks who won each pot.
 */
export const holdemConfig = z.object({
  cards: z.enum(['virtual', 'physical']).default('virtual'),
  startingStack: z.number().int().min(100).max(100_000).default(1000),
  smallBlind: z.number().int().min(1).max(5000).default(10),
  /** blinds double every N hands; 0 = never */
  blindLevelHands: z.number().int().min(0).max(50).default(10),
  /** seconds to act; 0 = no clock (on timeout: check if possible, otherwise fold) */
  actionSeconds: z.number().int().min(0).max(120).default(0),
});
export type HoldemConfig = z.infer<typeof holdemConfig>;

export const holdemAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fold') }),
  z.object({ type: z.literal('check') }),
  z.object({ type: z.literal('call') }),
  /** bet or raise *to* this total for the current street */
  z.object({ type: z.literal('raise'), to: z.number().int().min(1) }),
  z.object({ type: z.literal('allIn') }),
  /** physical cards: the table says who won pot #index (several = split) */
  z.object({
    type: z.literal('pickWinners'),
    pot: z.number().int().min(0).max(20),
    winners: z.array(z.string()).min(1),
  }),
  /** physical cards: the dealer has put the next board cards out */
  z.object({ type: z.literal('dealt') }),
  z.object({ type: z.literal('nextHand') }),
  z.object({ type: z.literal('end') }),
]);
export type HoldemAction = z.infer<typeof holdemAction>;

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];

export interface PotResult {
  amount: number;
  eligible: PlayerId[];
  winners: PlayerId[];
  category: Category | null;
}

export interface HoldemState {
  local: boolean;
  hostId: PlayerId;
  players: Player[];
  cfg: HoldemConfig;
  stacks: Record<PlayerId, number>;
  hand: number;
  sb: number;
  bb: number;
  button: PlayerId;
  /** seats dealt into this hand, in table order */
  inHand: PlayerId[];
  deck: CardId[];
  hole: Record<PlayerId, CardId[]>;
  board: CardId[];
  street: Street;
  phase: 'betting' | 'dealing' | 'pick' | 'handOver' | 'over';
  folded: PlayerId[];
  bets: Record<PlayerId, number>;
  contributed: Record<PlayerId, number>;
  currentBet: number;
  minRaise: number;
  toAct: PlayerId | null;
  acted: PlayerId[];
  /** players who may only call or fold (an all-in short raise doesn't reopen their action) */
  noReraise: PlayerId[];
  actionEndsAt: number | null;
  /** physical mode: pots waiting for the table's decision */
  pending: PotResult[];
  results: PotResult[] | null;
  shown: PlayerId[];
  log: Msg[];
  lastAction: Record<PlayerId, string>;
}

// ------------------------------------------------------------------ seat helpers

const name = (s: HoldemState, p: PlayerId) => s.players.find((x) => x.id === p)?.name ?? p;
const order = (s: HoldemState) => s.players.map((p) => p.id);

/** seats after `from` (exclusive) in table order, wrapping around, filtered */
function after(s: HoldemState, from: PlayerId, pool: PlayerId[]): PlayerId[] {
  const o = order(s);
  const i = o.indexOf(from);
  const rot = [...o.slice(i + 1), ...o.slice(0, i + 1)];
  return rot.filter((p) => pool.includes(p));
}

const live = (s: HoldemState) => s.inHand.filter((p) => !s.folded.includes(p));
/** players who can still put chips in */
const canAct = (s: HoldemState) => live(s).filter((p) => s.stacks[p]! > 0);

function blindsOf(s: HoldemState): { sbP: PlayerId; bbP: PlayerId } {
  if (s.inHand.length === 2) {
    // heads-up: the button posts the small blind
    const other = s.inHand.find((p) => p !== s.button)!;
    return { sbP: s.button, bbP: other };
  }
  const [sbP, bbP] = after(s, s.button, s.inHand);
  return { sbP: sbP!, bbP: bbP! };
}

function put(s: HoldemState, p: PlayerId, amount: number) {
  const a = Math.min(amount, s.stacks[p]!);
  s.stacks[p]! -= a;
  s.bets[p] = (s.bets[p] ?? 0) + a;
  s.contributed[p] = (s.contributed[p] ?? 0) + a;
  return a;
}

function say(s: HoldemState, p: PlayerId, k: string, amount?: number) {
  s.lastAction[p] = k;
  s.log.push({ k: `poker.log.${k}`, p: { name: name(s, p), n: amount ?? 0 } });
  if (s.log.length > 30) s.log.shift();
}

// ------------------------------------------------------------------ legal actions

export interface Legal {
  canCheck: boolean;
  toCall: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export function legal(s: HoldemState, p: PlayerId): Legal | null {
  if (s.phase !== 'betting' || s.toAct !== p) return null;
  const bet = s.bets[p] ?? 0;
  const stack = s.stacks[p]!;
  const toCall = Math.max(0, Math.min(s.currentBet - bet, stack));
  const maxRaiseTo = bet + stack;
  // someone else must be able to respond, and the action must be open for this player
  const others = canAct(s).filter((x) => x !== p);
  const canRaise = !s.noReraise.includes(p) && maxRaiseTo > s.currentBet && others.length > 0;
  const minRaiseTo = Math.min(maxRaiseTo, s.currentBet + s.minRaise);
  return { canCheck: bet >= s.currentBet, toCall, canRaise, minRaiseTo, maxRaiseTo };
}

// ------------------------------------------------------------------ hand flow

function deal(s: HoldemState, n: number) {
  if (s.cfg.cards !== 'virtual') return;
  s.deck.shift(); // burn
  for (let i = 0; i < n; i++) s.board.push(s.deck.shift()!);
}

function startHand(s: HoldemState, rng: Rng, now: number) {
  s.hand++;
  if (s.cfg.blindLevelHands > 0 && s.hand > 1 && (s.hand - 1) % s.cfg.blindLevelHands === 0) {
    s.sb *= 2;
    s.bb *= 2;
    s.log.push({ k: 'poker.log.blindsUp', p: { sb: s.sb, bb: s.bb } });
  }
  s.inHand = order(s).filter((p) => s.stacks[p]! > 0);
  s.folded = [];
  s.board = [];
  s.hole = {};
  s.bets = {};
  s.contributed = {};
  s.results = null;
  s.pending = [];
  s.shown = [];
  s.lastAction = {};
  s.street = 'preflop';
  s.phase = 'betting';
  s.deck = s.cfg.cards === 'virtual' ? rng.shuffle(FULL_DECK) : [];
  if (s.cfg.cards === 'virtual') {
    // two rounds, one card each, starting left of the button
    const seats = after(s, s.button, s.inHand);
    for (let r = 0; r < 2; r++) for (const p of seats) (s.hole[p] ??= []).push(s.deck.shift()!);
  }
  const { sbP, bbP } = blindsOf(s);
  put(s, sbP, s.sb);
  put(s, bbP, s.bb);
  s.lastAction[sbP] = 'sb';
  s.lastAction[bbP] = 'bb';
  // the full big blind is the bet to call even if the BB was short
  s.currentBet = s.bb;
  s.minRaise = s.bb;
  s.acted = [];
  s.noReraise = [];
  // preflop: first to act is left of the big blind (heads-up: the button/SB)
  const first = after(s, bbP, canAct(s))[0] ?? null;
  s.toAct = first;
  setClock(s, now);
  advanceIfDone(s, rng, now);
}

function setClock(s: HoldemState, now: number) {
  s.actionEndsAt = s.toAct && s.cfg.actionSeconds > 0 ? now + s.cfg.actionSeconds * 1000 : null;
}

function streetDone(s: HoldemState): boolean {
  const players = canAct(s);
  if (players.length === 0) return true;
  if (players.length === 1 && (s.bets[players[0]!] ?? 0) >= s.currentBet) return true;
  return players.every((p) => s.acted.includes(p) && (s.bets[p] ?? 0) === s.currentBet);
}

function nextActor(s: HoldemState, from: PlayerId): PlayerId | null {
  return (
    after(s, from, canAct(s)).find((p) => !s.acted.includes(p) || (s.bets[p] ?? 0) < s.currentBet) ?? null
  );
}

/** after every action: award, move to the next player, next street or showdown */
function advanceIfDone(s: HoldemState, rng: Rng, now: number) {
  if (live(s).length === 1) return awardUncontested(s);
  if (!streetDone(s)) {
    if (!s.toAct || !canAct(s).includes(s.toAct)) s.toAct = nextActor(s, s.toAct ?? s.button);
    setClock(s, now);
    return;
  }
  // close the street
  s.bets = {};
  s.currentBet = 0;
  s.minRaise = s.bb;
  s.acted = [];
  s.noReraise = [];
  const idx = STREETS.indexOf(s.street);
  if (idx === 3) return showdown(s);
  const runOut = canAct(s).length <= 1;
  s.street = STREETS[idx + 1]!;
  deal(s, s.street === 'flop' ? 3 : 1);
  if (s.cfg.cards === 'physical') {
    // the dealer puts the cards out; betting resumes (or the board runs out) after "dealt"
    s.phase = 'dealing';
    s.toAct = null;
    s.actionEndsAt = null;
    return;
  }
  if (runOut) return advanceIfDone(s, rng, now);
  s.toAct = after(s, s.button, canAct(s))[0] ?? null;
  setClock(s, now);
}

function awardUncontested(s: HoldemState) {
  const winner = live(s)[0]!;
  const amount = Object.values(s.contributed).reduce((a, b) => a + b, 0);
  s.stacks[winner]! += amount;
  s.results = [{ amount, eligible: [winner], winners: [winner], category: null }];
  s.log.push({ k: 'poker.log.wins', p: { name: name(s, winner), n: amount } });
  endHand(s);
}

function showdown(s: HoldemState) {
  const pots = buildPots(s.contributed, new Set(s.folded));
  const seatOrder = after(s, s.button, s.inHand);
  s.toAct = null;
  s.actionEndsAt = null;
  if (s.cfg.cards === 'virtual') {
    s.shown = live(s);
    const value = Object.fromEntries(s.shown.map((p) => [p, evaluate([...s.hole[p]!, ...s.board])]));
    s.results = pots.map((pot) => {
      const best = Math.max(...pot.eligible.map((p) => value[p]!.score));
      const winners = pot.eligible.filter((p) => value[p]!.score === best);
      const won = splitPot(pot.amount, winners, seatOrder);
      for (const [p, n] of Object.entries(won)) s.stacks[p]! += n;
      return { ...pot, winners, category: pot.eligible.length > 1 ? value[winners[0]!]!.category : null };
    });
    for (const r of s.results)
      s.log.push({
        k: 'poker.log.wins',
        p: { name: r.winners.map((w) => name(s, w)).join('، '), n: r.amount },
      });
    return endHand(s);
  }
  // physical cards: single-player pots (uncalled bets) settle themselves, the rest is decided by the table
  s.results = [];
  s.pending = pots.map((pot) => ({
    ...pot,
    winners: pot.eligible.length === 1 ? pot.eligible : [],
    category: null,
  }));
  settlePicked(s);
}

function settlePicked(s: HoldemState) {
  if (s.pending.some((p) => p.winners.length === 0)) {
    s.phase = 'pick';
    return;
  }
  const seatOrder = after(s, s.button, s.inHand);
  for (const pot of s.pending) {
    const won = splitPot(pot.amount, pot.winners, seatOrder);
    for (const [p, n] of Object.entries(won)) s.stacks[p]! += n;
    s.log.push({
      k: 'poker.log.wins',
      p: { name: pot.winners.map((w) => name(s, w)).join('، '), n: pot.amount },
    });
  }
  s.results = s.pending;
  s.pending = [];
  endHand(s);
}

function endHand(s: HoldemState) {
  s.phase = 'handOver';
  s.toAct = null;
  s.actionEndsAt = null;
  s.bets = {};
  if (order(s).filter((p) => s.stacks[p]! > 0).length <= 1) s.phase = 'over';
}

function act(
  s: HoldemState,
  p: PlayerId,
  a: Extract<HoldemAction, { type: 'fold' | 'check' | 'call' | 'raise' | 'allIn' }>,
): boolean {
  const l = legal(s, p);
  if (!l) return false;
  const bet = s.bets[p] ?? 0;
  switch (a.type) {
    case 'fold':
      s.folded.push(p);
      say(s, p, 'fold');
      break;
    case 'check':
      if (!l.canCheck) return false;
      say(s, p, 'check');
      break;
    case 'call': {
      if (l.canCheck) return false;
      const paid = put(s, p, l.toCall);
      say(s, p, s.stacks[p] === 0 ? 'allIn' : 'call', paid);
      break;
    }
    case 'raise':
    case 'allIn': {
      const to = a.type === 'allIn' ? l.maxRaiseTo : a.to;
      if (a.type === 'allIn' && (to <= s.currentBet || !l.canRaise)) {
        // all-in for a call (or less), or the action isn't open to raise: it's a call
        const paid = put(s, p, l.toCall);
        say(s, p, s.stacks[p] === 0 ? 'allIn' : paid ? 'call' : 'check', paid);
        break;
      }
      if (!l.canRaise || to > l.maxRaiseTo || to <= s.currentBet) return false;
      const isAllIn = to === l.maxRaiseTo;
      if (to < l.minRaiseTo && !isAllIn) return false;
      const raiseBy = to - s.currentBet;
      const wasBet = s.currentBet === 0;
      put(s, p, to - bet);
      if (raiseBy >= s.minRaise) {
        // a full raise reopens the betting for everyone
        s.minRaise = raiseBy;
        s.acted = [];
        s.noReraise = [];
      } else {
        // a short all-in: those who already acted may only call or fold
        s.noReraise = [...new Set([...s.noReraise, ...s.acted])];
        s.acted = [];
      }
      s.currentBet = to;
      say(s, p, isAllIn ? 'allIn' : wasBet ? 'bet' : 'raise', to);
      break;
    }
  }
  if (!s.acted.includes(p)) s.acted.push(p);
  return true;
}

// ------------------------------------------------------------------ module

export interface HoldemView {
  phase: HoldemState['phase'];
  mode: HoldemConfig['cards'];
  street: Street;
  hand: number;
  sb: number;
  bb: number;
  nextLevelIn: number | null;
  board: CardId[];
  pot: number;
  currentBet: number;
  toAct: PlayerId | null;
  actionEndsAt: number | null;
  actionSeconds: number;
  seats: {
    id: PlayerId;
    name: string;
    stack: number;
    bet: number;
    inHand: boolean;
    folded: boolean;
    allIn: boolean;
    button: boolean;
    sb: boolean;
    bb: boolean;
    lastAction: string | null;
    /** only the viewer's own cards, or everyone still in at a showdown */
    cards: CardId[] | null;
  }[];
  me: { hole: CardId[] | null; legal: Legal | null; category: Category | null } | null;
  pending: PotResult[];
  results: PotResult[] | null;
  log: Msg[];
  local: boolean;
}

export const holdem: GameModule<HoldemConfig, HoldemState, HoldemAction, HoldemView> = {
  id: 'cards.holdem',
  family: 'card',
  meta: META['cards.holdem'],
  configSchema: holdemConfig,
  actionSchema: holdemAction,
  defaultConfig: holdemConfig.parse({}),
  setup(players, cfg, rng, opts) {
    const s: HoldemState = {
      local: opts.local,
      hostId: opts.hostId,
      players,
      cfg,
      stacks: Object.fromEntries(players.map((p) => [p.id, cfg.startingStack])),
      hand: 0,
      sb: cfg.smallBlind,
      bb: cfg.smallBlind * 2,
      // the first hand's button is drawn at random
      button: rng.pick(players).id,
      inHand: [],
      deck: [],
      hole: {},
      board: [],
      street: 'preflop',
      phase: 'betting',
      folded: [],
      bets: {},
      contributed: {},
      currentBet: 0,
      minRaise: 0,
      toAct: null,
      acted: [],
      noReraise: [],
      actionEndsAt: null,
      pending: [],
      results: null,
      shown: [],
      log: [],
      lastAction: {},
    };
    startHand(s, rng, opts.now);
    return s;
  },
  reduce(state, action, actor, ctx) {
    const s = clone(state);
    const host = s.local || actor === s.hostId;
    switch (action.type) {
      case 'fold':
      case 'check':
      case 'call':
      case 'raise':
      case 'allIn': {
        // pass & play / physical: the shared screen acts for whoever's turn it is
        const who = s.local ? s.toAct : actor;
        if (!who || who !== s.toAct) return state;
        if (!act(s, who, action)) return state;
        s.toAct = nextActor(s, who) ?? s.toAct;
        advanceIfDone(s, ctx.rng, ctx.now);
        return s;
      }
      case '$timeout': {
        if (s.phase !== 'betting' || !s.toAct || !s.actionEndsAt || ctx.now < s.actionEndsAt) return state;
        const who = s.toAct;
        const l = legal(s, who)!;
        act(s, who, { type: l.canCheck ? 'check' : 'fold' });
        s.toAct = nextActor(s, who) ?? s.toAct;
        advanceIfDone(s, ctx.rng, ctx.now);
        return s;
      }
      case 'dealt': {
        if (s.phase !== 'dealing' || !host) return state;
        s.phase = 'betting';
        if (canAct(s).length <= 1) {
          // everyone is all-in: keep running the board out
          s.acted = canAct(s);
          advanceIfDone(s, ctx.rng, ctx.now);
          return s;
        }
        s.toAct = after(s, s.button, canAct(s))[0] ?? null;
        setClock(s, ctx.now);
        return s;
      }
      case 'pickWinners': {
        if (s.phase !== 'pick' || !host) return state;
        const pot = s.pending[action.pot];
        if (!pot || pot.winners.length) return state;
        const winners = [...new Set(action.winners)];
        if (!winners.every((w) => pot.eligible.includes(w))) return state;
        pot.winners = winners;
        settlePicked(s);
        return s;
      }
      case 'nextHand': {
        if (s.phase !== 'handOver' || !host) return state;
        const withChips = order(s).filter((p) => s.stacks[p]! > 0);
        s.button = after(s, s.button, withChips)[0] ?? s.button;
        startHand(s, ctx.rng, ctx.now);
        return s;
      }
      case 'end': {
        if (!host || s.phase === 'over') return state;
        // stop mid-hand: chips in the pot go back to their owners
        for (const [p, n] of Object.entries(s.contributed))
          if (s.phase === 'betting' || s.phase === 'dealing' || s.phase === 'pick') s.stacks[p]! += n;
        s.contributed = {};
        s.phase = 'over';
        s.toAct = null;
        s.actionEndsAt = null;
        return s;
      }
    }
  },
  viewFor(s, viewer) {
    const { sbP, bbP } = s.inHand.length >= 2 ? blindsOf(s) : { sbP: null, bbP: null };
    const me = viewer !== 'public' && s.players.some((p) => p.id === viewer) ? viewer : null;
    // pass & play with physical cards: the shared screen drives the betting for whoever's turn it is
    const tableActs = viewer === 'public' && s.local && s.cfg.cards === 'physical';
    const myHole = me ? (s.hole[me] ?? null) : null;
    const pot = Object.values(s.contributed).reduce((a, b) => a + b, 0);
    const levelEvery = s.cfg.blindLevelHands;
    return {
      phase: s.phase,
      mode: s.cfg.cards,
      street: s.street,
      hand: s.hand,
      sb: s.sb,
      bb: s.bb,
      nextLevelIn: levelEvery > 0 ? levelEvery - ((s.hand - 1) % levelEvery) : null,
      board: s.board,
      pot:
        s.phase === 'handOver' || s.phase === 'over'
          ? (s.results ?? []).reduce((a, r) => a + r.amount, 0)
          : pot,
      currentBet: s.currentBet,
      toAct: s.toAct,
      actionEndsAt: s.actionEndsAt,
      actionSeconds: s.cfg.actionSeconds,
      seats: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        stack: s.stacks[p.id]!,
        bet: s.bets[p.id] ?? 0,
        inHand: s.inHand.includes(p.id),
        folded: s.folded.includes(p.id),
        allIn:
          s.inHand.includes(p.id) &&
          !s.folded.includes(p.id) &&
          s.stacks[p.id] === 0 &&
          (s.phase === 'betting' || s.phase === 'dealing' || s.phase === 'pick'),
        button: p.id === s.button,
        sb: p.id === sbP,
        bb: p.id === bbP,
        lastAction: s.lastAction[p.id] ?? null,
        cards: p.id === me || s.shown.includes(p.id) ? (s.hole[p.id] ?? null) : null,
      })),
      me: tableActs
        ? { hole: null, legal: s.toAct ? legal(s, s.toAct) : null, category: null }
        : me
          ? {
              hole: myHole,
              legal: legal(s, me),
              category:
                myHole && s.board.length >= 3 && !s.folded.includes(me)
                  ? evaluate([...myHole, ...s.board]).category
                  : null,
            }
          : null,
      pending: s.pending,
      results: s.results,
      log: s.log.slice(-8),
      local: s.local,
    };
  },
  result(s): GameResult | null {
    if (s.phase !== 'over') return null;
    const ranking = [...s.players].sort((a, b) => s.stacks[b.id]! - s.stacks[a.id]!);
    const top = s.stacks[ranking[0]!.id]!;
    const winners = ranking.filter((p) => s.stacks[p.id] === top).map((p) => p.id);
    return {
      winners,
      title: { k: 'poker.result', p: { name: winners.map((w) => name(s, w)).join('، ') } },
      lines: [{ k: 'poker.resultLine', p: { n: top } }],
      scores: Object.fromEntries(ranking.slice(0, 3).map((p, i) => [p.id, 3 - i])),
      reveal: ranking.map((p) => ({ playerId: p.id, label: `🪙 ${s.stacks[p.id]}` })),
      highlights: winners.map((w) => ({ key: 'mvp', playerId: w })),
    };
  },
  // virtual cards in pass & play: the phone goes to whoever acts (their hole cards are private)
  pending: (s) => (s.local && s.cfg.cards === 'virtual' && s.phase === 'betting' && s.toAct ? [s.toAct] : []),
  deadline: (s) => (s.phase === 'betting' ? s.actionEndsAt : null),
  validate: (_c, n) =>
    n < 2 ? { k: 'err.minPlayers', p: { n: 2 } } : n > 10 ? { k: 'err.maxPlayers', p: { n: 10 } } : null,
  screens: { Setup: HoldemSetup, Play: HoldemPlay },
};
