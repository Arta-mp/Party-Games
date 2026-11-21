import { z } from 'zod';
import { itemsOf } from '@/content/builtin';
import { clone, type GameModule, type Player, type PlayerId } from '@/core/engine/types';
import { compactFa, firstLetter } from '@/lib/normalize';
import { META } from '../meta';
import { EsmFamilPlay, EsmFamilSetup } from './esmfamil-ui';

/**
 * «اسم فامیل»: random letter → everyone fills the columns at the same time → first to finish hits STOP
 * (others get a few seconds) → answers are judged by vote → unique 10 / duplicate 5 / only-one 20.
 */
export const EASY_LETTERS = 'ا ب پ ت ج چ ح خ د ر ز س ش ف ق ک گ ل م ن و ه ی'.split(' ');
export const HARD_LETTERS = 'ث ذ ژ ص ض ط ظ ع غ'.split(' ');

export const esmConfig = z.object({
  columns: z.array(z.string().trim().min(1).max(24)).min(3).max(12).default(['اسم', 'فامیل', 'شهر', 'کشور', 'غذا', 'حیوان', 'اشیا', 'رنگ']),
  rounds: z.number().int().min(1).max(10).default(3),
  roundSeconds: z.number().int().min(30).max(600).default(120),
  stopGraceSeconds: z.number().int().min(0).max(30).default(5),
  hardLetters: z.boolean().default(false),
});
export type EsmConfig = z.infer<typeof esmConfig>;

export const esmAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('answers'), answers: z.array(z.string().max(40)).max(12) }),
  z.object({ type: z.literal('stop') }),
  /** pass & play: the current writer starts their personal timer */
  z.object({ type: z.literal('startTurn') }),
  z.object({ type: z.literal('reject'), player: z.string(), col: z.number().int().min(0).max(11), reject: z.boolean() }),
  z.object({ type: z.literal('finishJudge') }),
  z.object({ type: z.literal('nextRound') }),
]);
export type EsmAction = z.infer<typeof esmAction>;

type Phase = 'write' | 'judge' | 'scored' | 'over';
export interface EsmState {
  local: boolean;
  hostId: PlayerId;
  players: Player[];
  cfg: EsmConfig;
  round: number;
  letters: string[];
  letter: string;
  phase: Phase;
  endsAt: number | null;
  stoppedBy: PlayerId | null;
  answers: Record<PlayerId, string[]>;
  submitted: PlayerId[];
  /** pass & play: per-player timer */
  turnEndsAt: number | null;
  /** rejections[player][col] = voters who reject that answer */
  rejections: Record<PlayerId, Record<number, PlayerId[]>>;
  roundScores: Record<PlayerId, number[]> | null;
  totals: Record<PlayerId, number>;
}

export interface EsmView {
  phase: Phase;
  round: number;
  rounds: number;
  letter: string;
  columns: string[];
  endsAt: number | null;
  stoppedBy: PlayerId | null;
  players: Player[];
  local: boolean;
  myAnswers: string[] | null;
  submitted: PlayerId[];
  turnEndsAt: number | null;
  /** answers of everyone — only after writing is over */
  board: { player: PlayerId; answers: string[]; valid: boolean[]; rejectVotes: number[]; myRejects: boolean[] }[] | null;
  roundScores: Record<PlayerId, number[]> | null;
  totals: Record<PlayerId, number>;
}

const hostOk = (s: EsmState, a: PlayerId) => s.local || a === s.hostId;

export function autoValid(answer: string, letter: string): boolean {
  const a = compactFa(answer);
  if (a.length < 2) return false;
  return firstLetter(answer) === compactFa(letter);
}

/** majority of the *other* players rejecting → invalid (in pass & play the shared screen decides) */
export function isRejected(s: EsmState, player: PlayerId, col: number): boolean {
  const votes = s.rejections[player]?.[col] ?? [];
  if (s.local) return votes.length > 0;
  const others = s.players.length - 1;
  return votes.length * 2 > others;
}

export function scoreRound(s: EsmState): Record<PlayerId, number[]> {
  const out: Record<PlayerId, number[]> = {};
  const valid = (p: PlayerId, c: number) => autoValid(s.answers[p]?.[c] ?? '', s.letter) && !isRejected(s, p, c);
  for (const p of s.players) out[p.id] = s.cfg.columns.map(() => 0);
  s.cfg.columns.forEach((_, c) => {
    const ok = s.players.filter((p) => valid(p.id, c));
    for (const p of ok) {
      const key = compactFa(s.answers[p.id]![c]!);
      const dup = ok.filter((o) => compactFa(s.answers[o.id]![c]!) === key).length > 1;
      out[p.id]![c] = ok.length === 1 ? 20 : dup ? 5 : 10;
    }
  });
  return out;
}

function startRound(s: EsmState, now: number, rngLetter: string) {
  s.letter = rngLetter;
  s.letters.push(rngLetter);
  s.phase = 'write';
  s.answers = Object.fromEntries(s.players.map((p) => [p.id, s.cfg.columns.map(() => '')]));
  s.submitted = [];
  s.stoppedBy = null;
  s.rejections = {};
  s.roundScores = null;
  s.turnEndsAt = null;
  s.endsAt = s.local ? null : now + s.cfg.roundSeconds * 1000;
}

function toJudge(s: EsmState) {
  s.phase = 'judge';
  s.endsAt = null;
  s.turnEndsAt = null;
}

function pickLetter(s: EsmState, rng: { pick<T>(x: readonly T[]): T }) {
  const pool = [...EASY_LETTERS, ...(s.cfg.hardLetters ? HARD_LETTERS : [])].filter((l) => !s.letters.includes(l));
  return rng.pick(pool.length ? pool : EASY_LETTERS);
}

export const esmFamil: GameModule<EsmConfig, EsmState, EsmAction, EsmView> = {
  id: 'party.esmfamil',
  family: 'party',
  meta: META['party.esmfamil'],
  configSchema: esmConfig,
  actionSchema: esmAction,
  defaultConfig: esmConfig.parse({}),
  setup(players, cfg, rng, opts) {
    const s: EsmState = {
      local: opts.local,
      hostId: opts.hostId,
      players,
      cfg,
      round: 1,
      letters: [],
      letter: '',
      phase: 'write',
      endsAt: null,
      stoppedBy: null,
      answers: {},
      submitted: [],
      turnEndsAt: null,
      rejections: {},
      roundScores: null,
      totals: Object.fromEntries(players.map((p) => [p.id, 0])),
    };
    startRound(s, opts.now, pickLetter(s, rng));
    return s;
  },
  reduce(state, action, actor, ctx) {
    const s = clone(state);
    switch (action.type) {
      case 'answers': {
        if (s.phase !== 'write' || s.submitted.includes(actor)) return state;
        s.answers[actor] = s.cfg.columns.map((_, i) => action.answers[i] ?? '');
        return s;
      }
      case 'startTurn': {
        if (!s.local || s.phase !== 'write' || s.turnEndsAt != null) return state;
        if (esmFamil.pending!(s)[0] !== actor) return state;
        s.turnEndsAt = ctx.now + s.cfg.roundSeconds * 1000;
        return s;
      }
      case 'stop': {
        if (s.phase !== 'write') return state;
        if (s.local) {
          // pass & play: STOP = "I'm done", the phone moves on
          if (s.submitted.includes(actor)) return state;
          s.submitted.push(actor);
          s.turnEndsAt = null;
          if (s.submitted.length === s.players.length) toJudge(s);
          return s;
        }
        if (s.stoppedBy) return state;
        const filled = (s.answers[actor] ?? []).every((a) => a.trim().length > 0);
        if (!filled) return state;
        s.stoppedBy = actor;
        s.endsAt = Math.min(s.endsAt ?? Infinity, ctx.now + s.cfg.stopGraceSeconds * 1000);
        if (s.cfg.stopGraceSeconds === 0) toJudge(s);
        return s;
      }
      case '$timeout': {
        if (s.phase !== 'write') return state;
        if (s.local) {
          const cur = esmFamil.pending!(s)[0];
          if (!cur) return state;
          s.submitted.push(cur);
          s.turnEndsAt = null;
          if (s.submitted.length === s.players.length) toJudge(s);
          return s;
        }
        toJudge(s);
        return s;
      }
      case 'reject': {
        if (s.phase !== 'judge' || (action.player === actor && !s.local)) return state;
        if (!s.players.some((p) => p.id === action.player) || action.col >= s.cfg.columns.length) return state;
        if (s.local && !hostOk(s, actor)) return state;
        s.rejections[action.player] ??= {};
        const list = (s.rejections[action.player]![action.col] ??= []);
        const has = list.includes(actor);
        if (action.reject && !has) list.push(actor);
        if (!action.reject && has) list.splice(list.indexOf(actor), 1);
        return s;
      }
      case 'finishJudge': {
        if (s.phase !== 'judge' || !hostOk(s, actor)) return state;
        s.roundScores = scoreRound(s);
        for (const [p, arr] of Object.entries(s.roundScores)) s.totals[p] = (s.totals[p] ?? 0) + arr.reduce((a, b) => a + b, 0);
        s.phase = s.round >= s.cfg.rounds ? 'over' : 'scored';
        return s;
      }
      case 'nextRound': {
        if (s.phase !== 'scored' || !hostOk(s, actor)) return state;
        s.round++;
        startRound(s, ctx.now, pickLetter(s, ctx.rng));
        return s;
      }
    }
  },
  viewFor(s, viewer) {
    const reveal = s.phase !== 'write';
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.cfg.rounds,
      letter: s.letter,
      columns: s.cfg.columns,
      endsAt: s.endsAt,
      stoppedBy: s.stoppedBy,
      players: s.players,
      local: s.local,
      myAnswers: viewer === 'public' ? null : (s.answers[viewer] ?? null),
      submitted: s.submitted,
      turnEndsAt: s.turnEndsAt,
      board: reveal
        ? s.players.map((p) => ({
            player: p.id,
            answers: s.answers[p.id] ?? [],
            valid: s.cfg.columns.map((_, c) => autoValid(s.answers[p.id]?.[c] ?? '', s.letter) && !isRejected(s, p.id, c)),
            rejectVotes: s.cfg.columns.map((_, c) => s.rejections[p.id]?.[c]?.length ?? 0),
            myRejects: s.cfg.columns.map((_, c) => viewer !== 'public' && !!s.rejections[p.id]?.[c]?.includes(viewer)),
          }))
        : null,
      roundScores: s.roundScores,
      totals: s.totals,
    };
  },
  result(s) {
    if (s.phase !== 'over') return null;
    const max = Math.max(...Object.values(s.totals));
    const winners = Object.keys(s.totals).filter((p) => s.totals[p] === max && max > 0);
    const scores: Record<PlayerId, number> = {};
    for (const w of winners) scores[w] = 3;
    return {
      winners,
      title: { k: 'esm.result', p: { names: winners.map((w) => s.players.find((p) => p.id === w)?.name ?? '').join('، ') || '—' } },
      lines: [{ k: 'esm.resultLine', p: { n: max } }],
      scores,
      reveal: s.players.map((p) => ({ playerId: p.id, label: `${s.totals[p.id] ?? 0}` })),
      highlights: winners.map((w) => ({ key: 'mvp', playerId: w })),
    };
  },
  pending(s) {
    if (s.phase === 'write' && s.local) return s.players.map((p) => p.id).filter((id) => !s.submitted.includes(id)).slice(0, 1);
    return [];
  },
  deadline: (s) => (s.phase !== 'write' ? null : s.local ? s.turnEndsAt : s.endsAt),
  validate: (_c, n) => (n < 2 ? { k: 'err.minPlayers', p: { n: 2 } } : null),
  screens: { Setup: EsmFamilSetup, Play: EsmFamilPlay },
};

export const defaultColumns = () => itemsOf('columns', undefined).map((c) => c.name);
