import { z } from 'zod';
import { itemsOf } from '@/content/builtin';
import { packSelection } from '@/content/schema';
import { clone, type GameModule, type Player, type PlayerId } from '@/core/engine/types';
import { META } from '../meta';
import { MostLikelyPlay, MostLikelySetup } from './mostlikely-ui';

/** «کی احتمالاً…»: secret vote for one player; results as a bar chart; +1 for agreeing with the majority. */
export const mlConfig = z.object({
  rounds: z.number().int().min(1).max(30).default(8),
  allowSelf: z.boolean().default(true),
  packs: packSelection.default({ builtin: ['mostlikely-fa'], custom: [] }),
});
export type MLConfig = z.infer<typeof mlConfig>;

export const mlAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('vote'), target: z.string() }),
  z.object({ type: z.literal('reveal') }),
  z.object({ type: z.literal('next') }),
]);
export type MLAction = z.infer<typeof mlAction>;

export interface MLState {
  local: boolean;
  hostId: PlayerId;
  players: Player[];
  cfg: MLConfig;
  questions: string[];
  index: number;
  phase: 'vote' | 'reveal' | 'over';
  votes: Record<PlayerId, PlayerId>;
  tally: Record<PlayerId, number> | null;
  points: Record<PlayerId, number>;
  history: { q: string; top: PlayerId[] }[];
}

export interface MLView {
  phase: MLState['phase'];
  question: string;
  index: number;
  total: number;
  players: Player[];
  allowSelf: boolean;
  voted: PlayerId[];
  myVote: PlayerId | null;
  tally: Record<PlayerId, number> | null;
  top: PlayerId[];
  points: Record<PlayerId, number>;
}

const hostOk = (s: MLState, a: PlayerId) => s.local || a === s.hostId;

function doReveal(s: MLState) {
  const t: Record<PlayerId, number> = {};
  for (const v of Object.values(s.votes)) t[v] = (t[v] ?? 0) + 1;
  s.tally = t;
  const max = Math.max(0, ...Object.values(t));
  const top = Object.keys(t).filter((k) => t[k] === max);
  for (const [voter, target] of Object.entries(s.votes)) if (top.includes(target)) s.points[voter] = (s.points[voter] ?? 0) + 1;
  s.history.push({ q: s.questions[s.index]!, top });
  s.phase = 'reveal';
}

export const mostLikely: GameModule<MLConfig, MLState, MLAction, MLView> = {
  id: 'party.mostlikely',
  family: 'party',
  meta: META['party.mostlikely'],
  configSchema: mlConfig,
  actionSchema: mlAction,
  defaultConfig: mlConfig.parse({}),
  setup(players, cfg, rng, opts) {
    const qs = itemsOf('questions', cfg.packs).filter((q) => !q.type).map((q) => q.q);
    return {
      local: opts.local,
      hostId: opts.hostId,
      players,
      cfg,
      questions: rng.sample(qs, Math.min(cfg.rounds, qs.length)),
      index: 0,
      phase: 'vote',
      votes: {},
      tally: null,
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      history: [],
    };
  },
  reduce(state, action, actor) {
    const s = clone(state);
    switch (action.type) {
      case 'vote':
        if (s.phase !== 'vote' || s.votes[actor] || !s.players.some((p) => p.id === action.target)) return state;
        if (!s.cfg.allowSelf && action.target === actor) return state;
        s.votes[actor] = action.target;
        if (s.players.every((p) => s.votes[p.id])) doReveal(s);
        return s;
      case 'reveal':
        if (s.phase !== 'vote' || !hostOk(s, actor) || Object.keys(s.votes).length === 0) return state;
        doReveal(s);
        return s;
      case 'next':
        if (s.phase !== 'reveal' || !hostOk(s, actor)) return state;
        s.votes = {};
        s.tally = null;
        s.index++;
        s.phase = s.index >= s.questions.length ? 'over' : 'vote';
        return s;
      default:
        return state;
    }
  },
  viewFor(s, viewer) {
    const top = s.tally ? Object.keys(s.tally).filter((k) => s.tally![k] === Math.max(...Object.values(s.tally!))) : [];
    return {
      phase: s.phase,
      question: s.questions[Math.min(s.index, s.questions.length - 1)] ?? '',
      index: s.index,
      total: s.questions.length,
      players: s.players,
      allowSelf: s.cfg.allowSelf,
      voted: Object.keys(s.votes),
      myVote: viewer === 'public' ? null : (s.votes[viewer] ?? null),
      tally: s.phase === 'vote' ? null : s.tally,
      top,
      points: s.points,
    };
  },
  result(s) {
    if (s.phase !== 'over') return null;
    const max = Math.max(...Object.values(s.points));
    const winners = Object.keys(s.points).filter((p) => s.points[p] === max && max > 0);
    return {
      winners,
      title: { k: 'ml.result' },
      lines: s.history.slice(-3).map((h) => ({ k: 'ml.historyLine', p: { q: h.q, names: h.top.map((id) => s.players.find((p) => p.id === id)?.name ?? '').join('، ') } })),
      scores: Object.fromEntries(winners.map((w) => [w, 2])),
      reveal: s.players.map((p) => ({ playerId: p.id, label: `${s.points[p.id] ?? 0}` })),
      highlights: winners.map((w) => ({ key: 'mvp', playerId: w })),
    };
  },
  pending: (s) => (s.phase === 'vote' ? s.players.map((p) => p.id).filter((id) => !s.votes[id]) : []),
  validate: (_c, n) => (n < 3 ? { k: 'err.minPlayers', p: { n: 3 } } : null),
  screens: { Setup: MostLikelySetup, Play: MostLikelyPlay },
};
