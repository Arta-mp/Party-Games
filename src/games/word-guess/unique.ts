import { z } from 'zod';
import { itemsOf } from '@/content/builtin';
import { packSelection } from '@/content/schema';
import { clone, type GameModule, type Player, type PlayerId } from '@/core/engine/types';
import { compactFa, sameAnswer } from '@/lib/normalize';
import { META } from '../meta';
import { UniquePlay, UniqueSetup } from './unique-ui';

/**
 * «سرنخ یکتا» (cooperative): everyone but the guesser secretly writes a one-word clue;
 * identical clues (after Persian normalisation) and clues equal to the word are removed automatically.
 */
export const uniqueConfig = z.object({
  rounds: z.number().int().min(3).max(20).default(10),
  packs: packSelection.default({ builtin: ['topics-fa'], custom: [] }),
});
export type UniqueConfig = z.infer<typeof uniqueConfig>;

export const uniqueAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('clue'), text: z.string().trim().min(1).max(30) }),
  z.object({ type: z.literal('guess'), text: z.string().trim().max(40) }),
  z.object({ type: z.literal('pass') }),
  /** table overrides the automatic judge (synonyms, typos) */
  z.object({ type: z.literal('accept') }),
  z.object({ type: z.literal('next') }),
]);
export type UniqueAction = z.infer<typeof uniqueAction>;

export interface UniqueState {
  local: boolean;
  hostId: PlayerId;
  players: Player[];
  words: string[];
  round: number;
  phase: 'clues' | 'guess' | 'result' | 'over';
  clues: Record<PlayerId, string>;
  kept: PlayerId[];
  guess: string | null;
  correct: boolean | null;
  score: number;
  history: { word: string; ok: boolean }[];
}

export interface UniqueView {
  phase: UniqueState['phase'];
  players: Player[];
  guesser: PlayerId;
  word: string | null;
  round: number;
  total: number;
  submitted: PlayerId[];
  myClue: string | null;
  /** shown to the guesser: only the unique clues; shown to others after the guess: all with strike-through */
  clues: { p: PlayerId; text: string; kept: boolean }[] | null;
  guess: string | null;
  correct: boolean | null;
  score: number;
}

export function uniqueClues(clues: Record<PlayerId, string>, word: string): PlayerId[] {
  const keyOf = (s: string) => compactFa(s);
  const counts = new Map<string, number>();
  for (const c of Object.values(clues)) counts.set(keyOf(c), (counts.get(keyOf(c)) ?? 0) + 1);
  return Object.keys(clues).filter((p) => {
    const k = keyOf(clues[p]!);
    return counts.get(k) === 1 && !sameAnswer(clues[p]!, word) && k.length > 0;
  });
}

const guesserOf = (s: UniqueState) => s.players[s.round % s.players.length]!.id;

export const uniqueClue: GameModule<UniqueConfig, UniqueState, UniqueAction, UniqueView> = {
  id: 'word.unique',
  family: 'word-guess',
  meta: META['word.unique'],
  configSchema: uniqueConfig,
  actionSchema: uniqueAction,
  defaultConfig: uniqueConfig.parse({}),
  setup: (players, cfg, rng, opts) => ({
    local: opts.local,
    hostId: opts.hostId,
    players: rng.shuffle(players),
    words: rng.sample(itemsOf('words', cfg.packs).map((w) => w.word), cfg.rounds),
    round: 0,
    phase: 'clues',
    clues: {},
    kept: [],
    guess: null,
    correct: null,
    score: 0,
    history: [],
  }),
  reduce(state, action, actor) {
    const s = clone(state);
    const guesser = guesserOf(s);
    const host = s.local || actor === s.hostId;
    switch (action.type) {
      case 'clue': {
        if (s.phase !== 'clues' || actor === guesser || s.clues[actor]) return state;
        // one word only
        const word = action.text.split(/\s+/)[0]!;
        s.clues[actor] = word;
        if (s.players.filter((p) => p.id !== guesser).every((p) => s.clues[p.id])) {
          s.kept = uniqueClues(s.clues, s.words[s.round]!);
          s.phase = 'guess';
        }
        return s;
      }
      case 'guess':
      case 'pass': {
        if (s.phase !== 'guess' || !(actor === guesser || s.local)) return state;
        s.guess = action.type === 'guess' ? action.text : null;
        s.correct = action.type === 'guess' ? sameAnswer(action.text, s.words[s.round]!) : false;
        if (s.correct) s.score++;
        s.phase = 'result';
        return s;
      }
      case 'accept':
        if (s.phase !== 'result' || s.correct || !host || s.guess == null) return state;
        s.correct = true;
        s.score++;
        return s;
      case 'next':
        if (s.phase !== 'result' || !host) return state;
        s.history.push({ word: s.words[s.round]!, ok: !!s.correct });
        s.round++;
        s.clues = {};
        s.kept = [];
        s.guess = null;
        s.correct = null;
        s.phase = s.round >= s.words.length ? 'over' : 'clues';
        return s;
      default:
        return state;
    }
  },
  viewFor(s, viewer) {
    const guesser = guesserOf(s);
    const isGuesser = viewer === guesser;
    const after = s.phase === 'result' || s.phase === 'over';
    return {
      phase: s.phase,
      players: s.players,
      guesser,
      word: isGuesser && !after ? null : viewer === 'public' && !after ? null : (s.words[Math.min(s.round, s.words.length - 1)] ?? null),
      round: s.round,
      total: s.words.length,
      submitted: Object.keys(s.clues),
      myClue: viewer === 'public' ? null : (s.clues[viewer] ?? null),
      clues:
        s.phase === 'guess' && (isGuesser || viewer === 'public')
          ? s.kept.map((p) => ({ p, text: s.clues[p]!, kept: true }))
          : s.phase === 'guess' || after
            ? Object.keys(s.clues).map((p) => ({ p, text: s.clues[p]!, kept: s.kept.includes(p) }))
            : null,
      guess: s.guess,
      correct: s.correct,
      score: s.score,
    };
  },
  result(s) {
    if (s.phase !== 'over') return null;
    const good = s.score * 2 >= s.words.length;
    return {
      winners: good ? s.players.map((p) => p.id) : [],
      title: { k: 'unique.result', p: { n: s.score, total: s.words.length } },
      lines: s.history.map((h) => ({ k: h.ok ? 'unique.histOk' : 'unique.histNo', p: { w: h.word } })),
      scores: Object.fromEntries(s.players.map((p) => [p.id, s.score])),
    };
  },
  pending: (s) => {
    const g = guesserOf(s);
    if (s.phase === 'clues') return s.players.map((p) => p.id).filter((p) => p !== g && !s.clues[p]);
    if (s.phase === 'guess') return [g];
    return [];
  },
  validate: (_c, n) => (n < 3 ? { k: 'err.minPlayers', p: { n: 3 } } : n > 10 ? { k: 'err.maxPlayers', p: { n: 10 } } : null),
  screens: { Setup: UniqueSetup, Play: UniquePlay },
};
