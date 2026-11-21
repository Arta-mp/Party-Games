import { z } from 'zod';
import { itemsOf } from '@/content/builtin';
import { packSelection } from '@/content/schema';
import { clone, type GameModule, type Player, type PlayerId } from '@/core/engine/types';
import { META } from '../meta';
import { TruthDarePlay, TruthDareSetup } from './truthdare-ui';

/**
 * «حقیقت یا جرأت»: a spinner picks a player, they choose truth or dare from the enabled categories;
 * any other player may replace the drawn card with one they write themselves.
 */
export const CATEGORIES = ['family', 'friends', 'spicy', 'couples', 'colleagues', 'adult'] as const;
export type TDCategory = (typeof CATEGORIES)[number];

export const tdConfig = z.object({
  categories: z.array(z.enum(CATEGORIES)).min(1).default(['family', 'friends']),
  turns: z.number().int().min(2).max(60).default(12),
  packs: packSelection.default({ builtin: ['truthdare-fa'], custom: [] }),
});
export type TDConfig = z.infer<typeof tdConfig>;

export const tdAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('spin') }),
  z.object({ type: z.literal('choose'), kind: z.enum(['truth', 'dare']) }),
  z.object({ type: z.literal('custom'), text: z.string().trim().min(3).max(200) }),
  z.object({ type: z.literal('done'), ok: z.boolean() }),
  z.object({ type: z.literal('end') }),
]);
export type TDAction = z.infer<typeof tdAction>;

export interface TDState {
  local: boolean;
  hostId: PlayerId;
  players: Player[];
  cfg: TDConfig;
  phase: 'spin' | 'choose' | 'task' | 'over';
  turn: number;
  current: PlayerId | null;
  spinId: number;
  kind: 'truth' | 'dare' | null;
  prompt: string | null;
  /** who wrote the current card (null = drawn from the deck) */
  author: PlayerId | null;
  used: string[];
  points: Record<PlayerId, number>;
}

export type TDView = Omit<TDState, 'used' | 'hostId' | 'cfg'> & { categories: TDCategory[]; turns: number };

export const truthDare: GameModule<TDConfig, TDState, TDAction, TDView> = {
  id: 'party.truthdare',
  family: 'party',
  meta: META['party.truthdare'],
  configSchema: tdConfig,
  actionSchema: tdAction,
  defaultConfig: tdConfig.parse({}),
  setup: (players, cfg, _rng, opts) => ({
    local: opts.local,
    hostId: opts.hostId,
    players,
    cfg,
    phase: 'spin',
    turn: 0,
    current: null,
    spinId: 0,
    kind: null,
    prompt: null,
    author: null,
    used: [],
    points: Object.fromEntries(players.map((p) => [p.id, 0])),
  }),
  reduce(state, action, actor, ctx) {
    const s = clone(state);
    const hostOk = s.local || actor === s.hostId;
    switch (action.type) {
      case 'spin': {
        if (s.phase !== 'spin' || !hostOk) return state;
        const pool = s.players.filter((p) => p.id !== s.current);
        s.current = ctx.rng.pick(pool.length ? pool : s.players).id;
        s.spinId++;
        s.phase = 'choose';
        return s;
      }
      case 'choose': {
        if (s.phase !== 'choose' || (actor !== s.current && !s.local)) return state;
        const cats: string[] = s.cfg.categories;
        const all = itemsOf('questions', s.cfg.packs).filter(
          (q) => q.type === action.kind && cats.includes(q.level ?? 'family'),
        );
        const fresh = all.filter((q) => !s.used.includes(q.q));
        const pick = ctx.rng.pick(fresh.length ? fresh : all.length ? all : [{ q: '—' }]);
        s.used.push(pick.q);
        s.kind = action.kind;
        s.prompt = pick.q;
        s.author = null;
        s.phase = 'task';
        return s;
      }
      case 'custom': {
        // someone else writes their own truth/dare for the chosen player
        if (s.phase !== 'task' || (actor === s.current && !s.local)) return state;
        s.prompt = action.text;
        s.author = actor;
        return s;
      }
      case 'done': {
        if (s.phase !== 'task' || !(hostOk || actor === s.current)) return state;
        if (action.ok && s.current)
          s.points[s.current] = (s.points[s.current] ?? 0) + (s.kind === 'dare' ? 2 : 1);
        s.turn++;
        s.kind = null;
        s.prompt = null;
        s.author = null;
        s.phase = s.turn >= s.cfg.turns ? 'over' : 'spin';
        return s;
      }
      case 'end':
        if (!hostOk || s.phase === 'over') return state;
        s.phase = 'over';
        return s;
      default:
        return state;
    }
  },
  viewFor: (s) => ({
    local: s.local,
    players: s.players,
    phase: s.phase,
    turn: s.turn,
    current: s.current,
    spinId: s.spinId,
    kind: s.kind,
    prompt: s.prompt,
    author: s.author,
    points: s.points,
    categories: s.cfg.categories,
    turns: s.cfg.turns,
  }),
  result(s) {
    if (s.phase !== 'over') return null;
    const max = Math.max(...Object.values(s.points));
    const winners = Object.keys(s.points).filter((p) => s.points[p] === max && max > 0);
    return {
      winners,
      title: { k: 'td.result' },
      scores: Object.fromEntries(winners.map((w) => [w, 2])),
      reveal: s.players.map((p) => ({ playerId: p.id, label: `${s.points[p.id] ?? 0}` })),
      highlights: winners.map((w) => ({ key: 'mvp', playerId: w })),
    };
  },
  validate: (_c, n) => (n < 2 ? { k: 'err.minPlayers', p: { n: 2 } } : null),
  screens: { Setup: TruthDareSetup, Play: TruthDarePlay },
};
