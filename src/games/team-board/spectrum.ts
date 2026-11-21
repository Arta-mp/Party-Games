import { z } from 'zod';
import { itemsOf } from '@/content/builtin';
import { packSelection } from '@/content/schema';
import { clone, type GameModule, type Player, type PlayerId } from '@/core/engine/types';
import { makeTeams } from '../word-guess/core';
import { META } from '../meta';
import { SpectrumPlay, SpectrumSetup } from './spectrum-ui';

/**
 * «طیف‌سنج»: a two-ended spectrum and a hidden target (0–100). The psychic gives a clue, the team moves
 * a shared dial, the other team bets left/right. 4/3/2 points by distance, +1 for a correct counter-bet.
 */
export const specConfig = z.object({
  target: z.number().int().min(3).max(20).default(10),
  maxRounds: z.number().int().min(2).max(30).default(12),
  packs: packSelection.default({ builtin: ['spectrums-fa'], custom: [] }),
});
export type SpecConfig = z.infer<typeof specConfig>;

export const specAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('clue'), text: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal('dial'), value: z.number().min(0).max(100) }),
  z.object({ type: z.literal('lock') }),
  z.object({ type: z.literal('counter'), side: z.enum(['left', 'right']) }),
  z.object({ type: z.literal('next') }),
]);
export type SpecAction = z.infer<typeof specAction>;

export interface SpecState {
  local: boolean;
  hostId: PlayerId;
  players: Player[];
  teams: PlayerId[][];
  cfg: SpecConfig;
  spectrums: { left: string; right: string }[];
  round: number;
  target: number;
  dial: number;
  clue: string | null;
  counter: 'left' | 'right' | null;
  phase: 'clue' | 'dial' | 'counter' | 'reveal' | 'over';
  scores: number[];
  last: { points: number; counterOk: boolean } | null;
}

export interface SpecView {
  phase: SpecState['phase'];
  players: Player[];
  teams: PlayerId[][];
  activeTeam: number;
  psychic: PlayerId;
  spectrum: { left: string; right: string };
  target: number | null;
  dial: number;
  clue: string | null;
  counter: SpecState['counter'];
  scores: number[];
  goal: number;
  round: number;
  myTeam: number;
  last: SpecState['last'];
  local: boolean;
}

export function pointsFor(dial: number, target: number): number {
  const d = Math.abs(dial - target);
  return d <= 4 ? 4 : d <= 12 ? 3 : d <= 20 ? 2 : 0;
}

const active = (s: SpecState) => s.round % s.teams.length;
const psychicOf = (s: SpecState) => {
  const team = s.teams[active(s)]!;
  return team[Math.floor(s.round / s.teams.length) % team.length]!;
};
const teamOf = (s: SpecState, p: PlayerId) => s.teams.findIndex((t) => t.includes(p));

export const spectrum: GameModule<SpecConfig, SpecState, SpecAction, SpecView> = {
  id: 'board.spectrum',
  family: 'team-board',
  meta: META['board.spectrum'],
  configSchema: specConfig,
  actionSchema: specAction,
  defaultConfig: specConfig.parse({}),
  setup(players, cfg, rng, opts) {
    return {
      local: opts.local,
      hostId: opts.hostId,
      players,
      teams: makeTeams(players, 2, rng),
      cfg,
      spectrums: rng.shuffle(itemsOf('spectrums', cfg.packs)),
      round: 0,
      target: rng.int(5, 95),
      dial: 50,
      clue: null,
      counter: null,
      phase: 'clue',
      scores: [0, 0],
      last: null,
    };
  },
  reduce(state, action, actor, ctx) {
    const s = clone(state);
    const a = active(s);
    const onTeam = s.local || (teamOf(s, actor) === a && actor !== psychicOf(s));
    switch (action.type) {
      case 'clue':
        if (s.phase !== 'clue' || !(actor === psychicOf(s) || s.local)) return state;
        s.clue = action.text;
        s.phase = 'dial';
        return s;
      case 'dial':
        if (s.phase !== 'dial' || !onTeam) return state;
        s.dial = Math.round(action.value);
        return s;
      case 'lock':
        if (s.phase !== 'dial' || !onTeam) return state;
        s.phase = 'counter';
        return s;
      case 'counter': {
        if (s.phase !== 'counter' || !(s.local || (teamOf(s, actor) >= 0 && teamOf(s, actor) !== a)))
          return state;
        s.counter = action.side;
        const pts = pointsFor(s.dial, s.target);
        const counterOk = pts < 4 && (action.side === 'left' ? s.target < s.dial : s.target > s.dial);
        s.scores[a]! += pts;
        if (counterOk) s.scores[1 - a]! += 1;
        s.last = { points: pts, counterOk };
        s.phase = s.scores.some((x) => x >= s.cfg.target) ? 'over' : 'reveal';
        return s;
      }
      case 'next':
        if (s.phase !== 'reveal' || !(s.local || actor === s.hostId || actor === psychicOf(s))) return state;
        s.round++;
        if (s.round >= s.cfg.maxRounds) {
          s.phase = 'over';
          return s;
        }
        s.target = ctx.rng.int(5, 95);
        s.dial = 50;
        s.clue = null;
        s.counter = null;
        s.phase = 'clue';
        return s;
      default:
        return state;
    }
  },
  viewFor(s, viewer) {
    const psychic = psychicOf(s);
    const reveal = s.phase === 'reveal' || s.phase === 'over';
    return {
      phase: s.phase,
      players: s.players,
      teams: s.teams,
      activeTeam: active(s),
      psychic,
      spectrum: s.spectrums[s.round % s.spectrums.length]!,
      target: reveal || (viewer === psychic && s.phase === 'clue') ? s.target : null,
      dial: s.dial,
      clue: s.clue,
      counter: s.counter,
      scores: s.scores,
      goal: s.cfg.target,
      round: s.round,
      myTeam: viewer === 'public' ? -1 : teamOf(s, viewer),
      last: s.last,
      local: s.local,
    };
  },
  result(s) {
    if (s.phase !== 'over') return null;
    const win = s.scores[0] === s.scores[1] ? -1 : s.scores[0]! > s.scores[1]! ? 0 : 1;
    const winners = win < 0 ? s.players.map((p) => p.id) : s.teams[win]!;
    return {
      winners,
      title: win < 0 ? { k: 'wg.result.tie' } : { k: 'wg.result.team', p: { team: win + 1 } },
      lines: s.scores.map((v, i) => ({ k: 'wg.teamScore', p: { team: i + 1, n: v } })),
      scores: Object.fromEntries(winners.map((w) => [w, 2])),
    };
  },
  pending: (s) => (s.phase === 'clue' ? [psychicOf(s)] : []),
  validate: (_c, n) => (n < 3 ? { k: 'err.minPlayers', p: { n: 3 } } : null),
  screens: { Setup: SpectrumSetup, Play: SpectrumPlay },
};
