import { z } from 'zod';
import { itemsOf } from '@/content/builtin';
import { packSelection } from '@/content/schema';
import { clone, GameError, type GameModule, type Player, type PlayerId } from '@/core/engine/types';
import { compactFa, sameAnswer } from '@/lib/normalize';
import { META } from '../meta';
import { LiarPlay, LiarSetup } from './liar-ui';

/**
 * «دروغ‌سنج»: a strange-but-true question; everyone writes a believable lie; the truth is shuffled in.
 * Pick what you think is true: +2 for the truth, +1 for every player your lie fooled.
 */
export const liarConfig = z.object({
  rounds: z.number().int().min(1).max(15).default(5),
  packs: packSelection.default({ builtin: ['trivia-fa'], custom: [] }),
});
export type LiarConfig = z.infer<typeof liarConfig>;

export const liarAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lie'), text: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal('pick'), option: z.number().int().min(0).max(30) }),
  /** vote for the funniest lie after the reveal (+1 to its author) */
  z.object({ type: z.literal('funny'), option: z.number().int().min(0).max(30) }),
  z.object({ type: z.literal('next') }),
]);
export type LiarAction = z.infer<typeof liarAction>;

interface Option {
  text: string;
  authors: PlayerId[]; // empty = the truth
}

export interface LiarState {
  local: boolean;
  hostId: PlayerId;
  players: Player[];
  questions: { q: string; answer: string }[];
  round: number;
  phase: 'write' | 'pick' | 'reveal' | 'over';
  lies: Record<PlayerId, string>;
  options: Option[];
  picks: Record<PlayerId, number>;
  scores: Record<PlayerId, number>;
  lastGain: Record<PlayerId, number>;
  funny: Record<PlayerId, number>;
  funnyWinners: number[] | null;
}

export interface LiarView {
  phase: LiarState['phase'];
  players: Player[];
  question: string;
  round: number;
  total: number;
  written: PlayerId[];
  myLie: string | null;
  /** options without authorship; own lie is excluded for the viewer */
  options: { index: number; text: string }[] | null;
  picked: PlayerId[];
  myPick: number | null;
  reveal: { text: string; truth: boolean; authors: PlayerId[]; pickedBy: PlayerId[] }[] | null;
  scores: Record<PlayerId, number>;
  lastGain: Record<PlayerId, number>;
  local: boolean;
  myFunny: number | null;
  funnyVoted: PlayerId[];
  funnyWinners: number[] | null;
}

function buildOptions(s: LiarState, rng: { shuffle<T>(x: readonly T[]): T[] }) {
  const truth = s.questions[s.round]!.answer;
  const opts: Option[] = [{ text: truth, authors: [] }];
  for (const [p, lie] of Object.entries(s.lies)) {
    const same = opts.find((o) => compactFa(o.text) === compactFa(lie));
    if (same) same.authors.push(p);
    else opts.push({ text: lie, authors: [p] });
  }
  s.options = rng.shuffle(opts);
}

function score(s: LiarState) {
  s.lastGain = {};
  const add = (p: PlayerId, n: number) => {
    s.scores[p] = (s.scores[p] ?? 0) + n;
    s.lastGain[p] = (s.lastGain[p] ?? 0) + n;
  };
  for (const [p, i] of Object.entries(s.picks)) {
    const o = s.options[i]!;
    if (o.authors.length === 0) add(p, 2);
    else for (const a of o.authors) if (a !== p) add(a, 1);
  }
}

/** +1 to the author(s) of the most-liked lie */
function finishFunny(s: LiarState) {
  const counts: Record<number, number> = {};
  for (const i of Object.values(s.funny)) counts[i] = (counts[i] ?? 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  const top =
    max > 0
      ? Object.keys(counts)
          .map(Number)
          .filter((i) => counts[i] === max)
      : [];
  for (const i of top)
    for (const a of s.options[i]!.authors) {
      s.scores[a] = (s.scores[a] ?? 0) + 1;
      s.lastGain[a] = (s.lastGain[a] ?? 0) + 1;
    }
  s.funnyWinners = top;
}

export const liar: GameModule<LiarConfig, LiarState, LiarAction, LiarView> = {
  id: 'party.liar',
  family: 'party',
  meta: META['party.liar'],
  configSchema: liarConfig,
  actionSchema: liarAction,
  defaultConfig: liarConfig.parse({}),
  setup(players, cfg, rng, opts) {
    const qs = itemsOf('trivia', cfg.packs);
    return {
      local: opts.local,
      hostId: opts.hostId,
      players,
      questions: rng.sample(qs, Math.min(cfg.rounds, qs.length)),
      round: 0,
      phase: 'write',
      lies: {},
      options: [],
      picks: {},
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      lastGain: {},
      funny: {},
      funnyWinners: null,
    };
  },
  reduce(state, action, actor, ctx) {
    const s = clone(state);
    switch (action.type) {
      case 'lie': {
        if (s.phase !== 'write' || s.lies[actor]) return state;
        // writing the real answer is not allowed: tell the player to try another lie
        if (sameAnswer(action.text, s.questions[s.round]!.answer)) throw new GameError('liar-too-true');
        s.lies[actor] = action.text;
        if (s.players.every((p) => s.lies[p.id])) {
          buildOptions(s, ctx.rng);
          s.phase = 'pick';
        }
        return s;
      }
      case 'pick': {
        if (s.phase !== 'pick' || s.picks[actor] != null) return state;
        const o = s.options[action.option];
        if (!o || o.authors.includes(actor)) return state;
        s.picks[actor] = action.option;
        if (s.players.every((p) => s.picks[p.id] != null)) {
          score(s);
          s.phase = 'reveal';
        }
        return s;
      }
      case 'funny': {
        if (s.phase !== 'reveal' || s.funnyWinners) return state;
        const o = s.options[action.option];
        if (
          !o ||
          o.authors.length === 0 ||
          (!s.local && (o.authors.includes(actor) || s.funny[actor] != null))
        )
          return state;
        s.funny[actor] = action.option;
        // pass & play: the table picks one together; online: when everyone has voted
        const voters = s.players.filter((p) =>
          s.options.some((x) => x.authors.length && !x.authors.includes(p.id)),
        );
        if (s.local || voters.every((p) => s.funny[p.id] != null)) finishFunny(s);
        return s;
      }
      case 'next':
        if (s.phase !== 'reveal' || !(s.local || actor === s.hostId)) return state;
        if (!s.funnyWinners) finishFunny(s);
        s.round++;
        s.funny = {};
        s.funnyWinners = null;
        s.lies = {};
        s.picks = {};
        s.options = [];
        s.phase = s.round >= s.questions.length ? 'over' : 'write';
        return s;
      default:
        return state;
    }
  },
  viewFor(s, viewer) {
    const reveal = s.phase === 'reveal' || s.phase === 'over';
    return {
      phase: s.phase,
      players: s.players,
      question: s.questions[Math.min(s.round, s.questions.length - 1)]!.q,
      round: s.round,
      total: s.questions.length,
      written: Object.keys(s.lies),
      myLie: viewer === 'public' ? null : (s.lies[viewer] ?? null),
      options:
        s.phase === 'pick'
          ? s.options
              .map((o, index) => ({
                index,
                text: o.text,
                mine: viewer !== 'public' && o.authors.includes(viewer),
              }))
              .filter((o) => !o.mine)
              .map(({ index, text }) => ({ index, text }))
          : null,
      picked: Object.keys(s.picks),
      myPick: viewer === 'public' ? null : (s.picks[viewer] ?? null),
      reveal:
        reveal && s.options.length
          ? s.options.map((o, i) => ({
              text: o.text,
              truth: o.authors.length === 0,
              authors: o.authors,
              pickedBy: Object.keys(s.picks).filter((p) => s.picks[p] === i),
            }))
          : null,
      scores: s.scores,
      lastGain: s.lastGain,
      myFunny: viewer === 'public' ? null : (s.funny[viewer] ?? null),
      funnyVoted: Object.keys(s.funny),
      funnyWinners: s.funnyWinners,
      local: s.local,
    };
  },
  result(s) {
    if (s.phase !== 'over') return null;
    const max = Math.max(...Object.values(s.scores));
    const winners = Object.keys(s.scores).filter((p) => s.scores[p] === max && max > 0);
    return {
      winners,
      title: { k: 'liar.result' },
      scores: Object.fromEntries(winners.map((w) => [w, 3])),
      reveal: s.players.map((p) => ({ playerId: p.id, label: String(s.scores[p.id] ?? 0) })),
      highlights: winners.map((w) => ({ key: 'mvp', playerId: w })),
    };
  },
  pending(s) {
    if (s.phase === 'write') return s.players.map((p) => p.id).filter((p) => !s.lies[p]);
    if (s.phase === 'pick') return s.players.map((p) => p.id).filter((p) => s.picks[p] == null);
    return [];
  },
  validate: (_c, n) =>
    n < 3 ? { k: 'err.minPlayers', p: { n: 3 } } : n > 10 ? { k: 'err.maxPlayers', p: { n: 10 } } : null,
  screens: { Setup: LiarSetup, Play: LiarPlay },
};
