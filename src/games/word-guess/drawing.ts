import { z } from 'zod';
import { itemsOf } from '@/content/builtin';
import { packSelection } from '@/content/schema';
import { clone, type GameModule, type Player, type PlayerId } from '@/core/engine/types';
import { sameAnswer } from '@/lib/normalize';
import { META } from '../meta';
import { DrawingPlay, DrawingSetup } from './drawing-ui';

/**
 * «نقاشی حدس»: the drawer sees a word and draws on an in-app canvas (strokes are streamed to everyone
 * in a compact text encoding) or on paper. Guesses are typed and matched with Persian normalisation.
 */

// ------------------------------------------------------------------ stroke codec (12-bit, 2 chars per coordinate)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function encodePoints(points: [number, number][]): string {
  let out = '';
  for (const [x, y] of points) {
    for (const v of [x, y]) {
      const q = Math.max(0, Math.min(4095, Math.round(v * 4095)));
      out += B64[q >> 6]! + B64[q & 63]!;
    }
  }
  return out;
}
export function decodePoints(d: string): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i + 3 < d.length; i += 4) {
    const v = (j: number) => ((B64.indexOf(d[j]!) << 6) | B64.indexOf(d[j + 1]!)) / 4095;
    pts.push([v(i), v(i + 2)]);
  }
  return pts;
}
/** drop points closer than `eps` (normalised units) to shrink strokes before sending */
export function simplify(points: [number, number][], eps = 0.004): [number, number][] {
  if (points.length < 3) return points;
  const out: [number, number][] = [points[0]!];
  for (const p of points.slice(1, -1)) {
    const last = out[out.length - 1]!;
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= eps) out.push(p);
  }
  out.push(points[points.length - 1]!);
  return out;
}

export const COLORS = ['#1b1724', '#e5484d', '#3b82f6', '#16a34a', '#f59e0b', '#a855f7', '#ffffff'];
export const WIDTHS = [3, 6, 12, 24];

export const drawConfig = z.object({
  canvas: z.boolean().default(true),
  turnSeconds: z.number().int().min(30).max(240).default(80),
  rounds: z.number().int().min(1).max(4).default(1),
  packs: packSelection.default({ builtin: ['draw-fa'], custom: [] }),
});
export type DrawConfig = z.infer<typeof drawConfig>;

const strokeSchema = z.object({
  c: z.number().int().min(0).max(COLORS.length - 1),
  w: z.number().int().min(0).max(WIDTHS.length - 1),
  d: z.string().max(2400).regex(/^[A-Za-z0-9_-]*$/),
});
export type Stroke = z.infer<typeof strokeSchema>;

export const drawAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('stroke'), s: strokeSchema }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('clear') }),
  z.object({ type: z.literal('guess'), text: z.string().trim().min(1).max(40) }),
  z.object({ type: z.literal('mark'), player: z.string() }),
  z.object({ type: z.literal('next') }),
]);
export type DrawAction = z.infer<typeof drawAction>;

export interface DrawState {
  local: boolean;
  hostId: PlayerId;
  players: Player[];
  cfg: DrawConfig;
  order: PlayerId[];
  turn: number;
  words: string[];
  phase: 'ready' | 'draw' | 'reveal' | 'over';
  endsAt: number | null;
  strokes: Stroke[];
  guesses: { p: PlayerId; text: string; ok: boolean }[];
  solved: PlayerId[];
  scores: Record<PlayerId, number>;
}

export interface DrawView {
  phase: DrawState['phase'];
  players: Player[];
  drawer: PlayerId;
  canvas: boolean;
  word: string | null;
  wordLength: number;
  endsAt: number | null;
  turnSeconds: number;
  turn: number;
  totalTurns: number;
  strokes: Stroke[];
  guesses: { p: PlayerId; text: string | null; ok: boolean }[];
  solved: PlayerId[];
  scores: Record<PlayerId, number>;
  local: boolean;
}

const MAX_STROKES = 600;
const drawerOf = (s: DrawState) => s.order[s.turn % s.order.length]!;

function solve(s: DrawState, p: PlayerId) {
  if (s.solved.includes(p) || p === drawerOf(s)) return;
  const pts = Math.max(1, 3 - s.solved.length);
  s.solved.push(p);
  s.scores[p] = (s.scores[p] ?? 0) + pts;
  if (s.solved.length <= 3) s.scores[drawerOf(s)] = (s.scores[drawerOf(s)] ?? 0) + 1;
  if (s.solved.length >= s.players.length - 1) {
    s.phase = 'reveal';
    s.endsAt = null;
  }
}

export const drawing: GameModule<DrawConfig, DrawState, DrawAction, DrawView> = {
  id: 'word.drawing',
  family: 'word-guess',
  meta: META['word.drawing'],
  configSchema: drawConfig,
  actionSchema: drawAction,
  defaultConfig: drawConfig.parse({}),
  setup(players, cfg, rng, opts) {
    const order = Array.from({ length: cfg.rounds }, () => rng.shuffle(players.map((p) => p.id))).flat();
    const words = rng.sample(itemsOf('words', cfg.packs).map((w) => w.word), order.length);
    return {
      local: opts.local,
      hostId: opts.hostId,
      players,
      cfg,
      order,
      turn: 0,
      words,
      phase: 'ready',
      endsAt: null,
      strokes: [],
      guesses: [],
      solved: [],
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    };
  },
  reduce(state, action, actor, ctx) {
    const s = clone(state);
    const drawer = drawerOf(s);
    const drawerOrHost = actor === drawer || s.local || actor === s.hostId;
    switch (action.type) {
      case 'start':
        if (s.phase !== 'ready' || !drawerOrHost) return state;
        s.phase = 'draw';
        s.endsAt = ctx.now + s.cfg.turnSeconds * 1000;
        s.strokes = [];
        s.guesses = [];
        s.solved = [];
        return s;
      case 'stroke':
        if (s.phase !== 'draw' || !(actor === drawer || s.local) || s.strokes.length >= MAX_STROKES) return state;
        s.strokes.push(action.s);
        return s;
      case 'undo':
        if (s.phase !== 'draw' || !(actor === drawer || s.local)) return state;
        s.strokes.pop();
        return s;
      case 'clear':
        if (s.phase !== 'draw' || !(actor === drawer || s.local)) return state;
        s.strokes = [];
        return s;
      case 'guess': {
        if (s.phase !== 'draw' || actor === drawer || s.solved.includes(actor)) return state;
        const ok = sameAnswer(action.text, s.words[s.turn]!);
        s.guesses.push({ p: actor, text: action.text, ok });
        if (s.guesses.length > 80) s.guesses.shift();
        if (ok) solve(s, actor);
        return s;
      }
      case 'mark':
        if (s.phase !== 'draw' || !drawerOrHost || !s.players.some((p) => p.id === action.player)) return state;
        solve(s, action.player);
        return s;
      case '$timeout':
        if (s.phase !== 'draw') return state;
        s.phase = 'reveal';
        s.endsAt = null;
        return s;
      case 'next':
        if (s.phase !== 'reveal' || !drawerOrHost) return state;
        s.turn++;
        s.phase = s.turn >= s.order.length ? 'over' : 'ready';
        return s;
      default:
        return state;
    }
  },
  viewFor(s, viewer) {
    const drawer = drawerOf(s);
    const reveal = s.phase === 'reveal' || s.phase === 'over';
    const word = s.words[Math.min(s.turn, s.words.length - 1)]!;
    return {
      phase: s.phase,
      players: s.players,
      drawer,
      canvas: s.cfg.canvas,
      word: reveal || (viewer === drawer && s.phase !== 'ready') ? word : null,
      wordLength: [...word.replace(/\s/g, '')].length,
      endsAt: s.endsAt,
      turnSeconds: s.cfg.turnSeconds,
      turn: s.turn,
      totalTurns: s.order.length,
      strokes: s.strokes,
      // correct guesses would reveal the word: hide their text until the reveal
      guesses: s.guesses.map((g) => ({ p: g.p, ok: g.ok, text: g.ok && !reveal && viewer !== g.p ? null : g.text })),
      solved: s.solved,
      scores: s.scores,
      local: s.local,
    };
  },
  result(s) {
    if (s.phase !== 'over') return null;
    const max = Math.max(...Object.values(s.scores));
    const winners = Object.keys(s.scores).filter((p) => s.scores[p] === max && max > 0);
    return {
      winners,
      title: { k: 'draw.result' },
      scores: Object.fromEntries(winners.map((w) => [w, 2])),
      reveal: s.players.map((p) => ({ playerId: p.id, label: String(s.scores[p.id] ?? 0) })),
      highlights: winners.map((w) => ({ key: 'mvp', playerId: w })),
    };
  },
  pending: (s) => (s.phase === 'draw' && s.local ? [drawerOf(s)] : []),
  deadline: (s) => (s.phase === 'draw' ? s.endsAt : null),
  validate: (_c, n) => (n < 3 ? { k: 'err.minPlayers', p: { n: 3 } } : null),
  screens: { Setup: DrawingSetup, Play: DrawingPlay },
};
