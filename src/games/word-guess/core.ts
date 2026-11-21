import { z } from 'zod';
import type { Rng } from '@/core/engine/rng';
import {
  clone,
  type Ctx,
  type GameResult,
  type Player,
  type PlayerId,
  type SetupOptions,
  type SystemAction,
} from '@/core/engine/types';

/**
 * Shared team core of the word-guess family (§6-ج): auto teams, turn order, cards, turn timer,
 * correct / skip (/ buzz) and a scoreboard. Modes only decide what a card is and who may see it.
 */
export type CardVisibility = 'performer' | 'performer+opponents' | 'everyone';

export interface Card {
  word: string;
  /** extra lines shown with the card (forbidden words, category…) */
  extra: string[];
  category: string | null;
}

export const wgBaseConfig = {
  /** 0 = everyone plays for themselves */
  teams: z.number().int().min(0).max(4).default(2),
  turnSeconds: z.number().int().min(20).max(300).default(60),
  /** how many times each player performs */
  rounds: z.number().int().min(1).max(5).default(1),
  skipPenalty: z.boolean().default(false),
  /** first team to reach this score wins (checked at the end of a turn); 0 = play the rounds above */
  targetScore: z.number().int().min(0).max(200).default(30),
  /** host's manual team choice: player id → team index; unassigned players are spread automatically */
  manualTeams: z.record(z.string(), z.number().int().min(0).max(3)).default({}),
};

/** safety cap on turns when playing to a target score */
const MAX_TARGET_ROUNDS = 10;

export const wgAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('correct') }),
  z.object({ type: z.literal('skip') }),
  z.object({ type: z.literal('buzz') }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('end') }),
]);
export type WGAction = z.infer<typeof wgAction>;

export interface WGState {
  mode: string;
  local: boolean;
  hostId: PlayerId;
  players: Player[];
  teams: PlayerId[][];
  visibility: CardVisibility;
  allowBuzz: boolean;
  turnSeconds: number;
  skipPenalty: boolean;
  deck: Card[];
  pos: number;
  turn: number;
  totalTurns: number;
  targetScore: number;
  phase: 'ready' | 'turn' | 'turnEnd' | 'over';
  endsAt: number | null;
  scores: number[];
  /** per-player points scored while performing (for MVP) */
  performed: Record<PlayerId, number>;
  log: { word: string; result: 'correct' | 'skip' | 'buzz' }[];
}

export function makeTeams(
  players: Player[],
  n: number,
  rng: Rng,
  manual: Record<PlayerId, number> = {},
): PlayerId[][] {
  const ids = rng.shuffle(players.map((p) => p.id));
  if (n === 0) return ids.map((id) => [id]);
  const teams: PlayerId[][] = Array.from({ length: n }, () => []);
  const free: PlayerId[] = [];
  for (const id of ids) {
    const t = manual[id];
    if (t != null && t < n) teams[t]!.push(id);
    else free.push(id);
  }
  // spread the rest, always into the currently smallest team
  for (const id of free) {
    const smallest = teams.reduce((best, t, i) => (t.length < teams[best]!.length ? i : best), 0);
    teams[smallest]!.push(id);
  }
  return teams.filter((t) => t.length > 0);
}

export function performerOf(s: Pick<WGState, 'teams' | 'turn'>): { team: number; player: PlayerId } {
  const team = s.turn % s.teams.length;
  const round = Math.floor(s.turn / s.teams.length);
  const members = s.teams[team]!;
  return { team, player: members[round % members.length]! };
}

export function setupWG(
  mode: string,
  players: Player[],
  cfg: {
    teams: number;
    turnSeconds: number;
    rounds: number;
    skipPenalty: boolean;
    targetScore?: number;
    manualTeams?: Record<PlayerId, number>;
  },
  deck: Card[],
  opts: SetupOptions,
  rng: Rng,
  extra: { visibility: CardVisibility; allowBuzz: boolean },
): WGState {
  const teams = makeTeams(players, Math.min(cfg.teams, players.length), rng, cfg.manualTeams);
  const maxSize = Math.max(...teams.map((t) => t.length));
  const target = cfg.targetScore ?? 0;
  return {
    mode,
    local: opts.local,
    hostId: opts.hostId,
    players,
    teams,
    visibility: extra.visibility,
    allowBuzz: extra.allowBuzz,
    turnSeconds: cfg.turnSeconds,
    skipPenalty: cfg.skipPenalty,
    deck: rng.shuffle(deck),
    pos: 0,
    turn: 0,
    totalTurns: teams.length * maxSize * (target > 0 ? MAX_TARGET_ROUNDS : cfg.rounds),
    targetScore: target,
    phase: 'ready',
    endsAt: null,
    scores: teams.map(() => 0),
    performed: {},
    log: [],
  };
}

const teamOf = (s: WGState, p: PlayerId) => s.teams.findIndex((t) => t.includes(p));

function advanceCard(s: WGState, result: 'correct' | 'skip' | 'buzz') {
  const card = s.deck[s.pos % s.deck.length]!;
  s.log.push({ word: card.word, result });
  s.pos++;
}

export function reduceWG(
  state: WGState,
  action: WGAction | SystemAction,
  actor: PlayerId,
  ctx: Ctx,
): WGState {
  const s = clone(state);
  const { team, player } = performerOf(s);
  const isPerformer = actor === player || s.local;
  const host = s.local || actor === s.hostId;
  switch (action.type) {
    case 'start':
      if (s.phase !== 'ready' || !(isPerformer || host)) return state;
      s.phase = 'turn';
      s.endsAt = ctx.now + s.turnSeconds * 1000;
      s.log = [];
      return s;
    case 'correct':
      if (s.phase !== 'turn' || !isPerformer) return state;
      s.scores[team]! += 1;
      s.performed[player] = (s.performed[player] ?? 0) + 1;
      advanceCard(s, 'correct');
      return s;
    case 'skip':
      if (s.phase !== 'turn' || !isPerformer) return state;
      if (s.skipPenalty) s.scores[team]! -= 1;
      advanceCard(s, 'skip');
      return s;
    case 'buzz': {
      // only an opponent (or the shared phone) can press the buzzer
      if (s.phase !== 'turn' || !s.allowBuzz) return state;
      if (!s.local && (teamOf(s, actor) === team || teamOf(s, actor) < 0)) return state;
      s.scores[team]! -= 1;
      advanceCard(s, 'buzz');
      return s;
    }
    case '$timeout':
      if (s.phase !== 'turn') return state;
      s.phase = 'turnEnd';
      s.endsAt = null;
      return s;
    case 'next':
      if (s.phase !== 'turnEnd' || !(isPerformer || host)) return state;
      s.turn++;
      s.phase =
        s.turn >= s.totalTurns || (s.targetScore > 0 && s.scores.some((x) => x >= s.targetScore))
          ? 'over'
          : 'ready';
      return s;
    case 'end':
      if (!host || s.phase === 'over') return state;
      s.phase = 'over';
      s.endsAt = null;
      return s;
    default:
      return state;
  }
}

export interface WGView {
  mode: string;
  phase: WGState['phase'];
  players: Player[];
  teams: PlayerId[][];
  performer: PlayerId;
  performerTeam: number;
  myTeam: number;
  endsAt: number | null;
  turnSeconds: number;
  turn: number;
  totalTurns: number;
  targetScore: number;
  scores: number[];
  card: Card | null;
  canSeeCard: boolean;
  allowBuzz: boolean;
  log: WGState['log'];
  local: boolean;
}

export function canSee(s: WGState, viewer: PlayerId | 'public'): boolean {
  const { team, player } = performerOf(s);
  if (s.visibility === 'everyone') return true;
  if (viewer === 'public') return false;
  if (viewer === player) return true;
  return s.visibility === 'performer+opponents' && teamOf(s, viewer) !== team;
}

export function viewWG(s: WGState, viewer: PlayerId | 'public'): WGView {
  const { team, player } = performerOf(s);
  const see = s.phase === 'turn' && canSee(s, viewer);
  return {
    mode: s.mode,
    phase: s.phase,
    players: s.players,
    teams: s.teams,
    performer: player,
    performerTeam: team,
    myTeam: viewer === 'public' ? -1 : teamOf(s, viewer),
    endsAt: s.endsAt,
    turnSeconds: s.turnSeconds,
    turn: s.turn,
    totalTurns: s.totalTurns,
    targetScore: s.targetScore,
    scores: s.scores,
    card: see ? s.deck[s.pos % s.deck.length]! : null,
    canSeeCard: see,
    allowBuzz: s.allowBuzz,
    log: s.phase === 'turn' && !see ? s.log.map((l) => ({ ...l, word: '•••' })) : s.log,
    local: s.local,
  };
}

export function resultWG(s: WGState): GameResult | null {
  if (s.phase !== 'over') return null;
  const max = Math.max(...s.scores);
  const winTeams = s.scores.map((v, i) => (v === max ? i : -1)).filter((i) => i >= 0);
  const winners = winTeams.flatMap((i) => s.teams[i]!);
  const mvp = Object.entries(s.performed).sort((a, b) => b[1] - a[1])[0];
  return {
    winners,
    title:
      winTeams.length > 1
        ? { k: 'wg.result.tie' }
        : {
            k: s.teams.every((t) => t.length === 1) ? 'wg.result.player' : 'wg.result.team',
            p: {
              team: winTeams[0]! + 1,
              name: s.players.find((p) => p.id === s.teams[winTeams[0]!]![0])?.name ?? '',
            },
          },
    lines: s.scores.map((v, i) => ({ k: 'wg.teamScore', p: { team: i + 1, n: v } })),
    scores: Object.fromEntries(winners.map((w) => [w, 2])),
    reveal: s.players.map((p) => ({
      playerId: p.id,
      label: `${s.teams.length > 1 && s.teams.some((t) => t.length > 1) ? `T${teamOf(s, p.id) + 1} · ` : ''}${s.performed[p.id] ?? 0}`,
    })),
    highlights: mvp && mvp[1] > 0 ? [{ key: 'mvp', playerId: mvp[0] }] : [],
  };
}

/** pass & play: during a performer-only turn the phone belongs to the performer */
export function pendingWG(s: WGState): PlayerId[] {
  if (s.phase === 'turn' && s.visibility !== 'everyone') return [performerOf(s).player];
  return [];
}
