import { z } from 'zod';
import { itemsOf } from '@/content/builtin';
import { packSelection } from '@/content/schema';
import { clone, type GameModule, type Player, type PlayerId } from '@/core/engine/types';
import { META } from '../meta';
import { DuetPlay, DuetSetup } from './duet-ui';

/**
 * «رمزواژه‌ی دونفره» (co-op): each player has their own half of the key: 9 agents (G) and 3 assassins (A).
 * Cells are (keyA, keyB) pairs: GG×3, GN×5, NG×5, GA, AG, AA, AN, NA, NN×7. Find all 15 agents in time.
 */
export type K = 'G' | 'N' | 'A';
export const DUET_CELLS: [K, K][] = [
  ...Array<[K, K]>(3).fill(['G', 'G']),
  ...Array<[K, K]>(5).fill(['G', 'N']),
  ...Array<[K, K]>(5).fill(['N', 'G']),
  ['G', 'A'],
  ['A', 'G'],
  ['A', 'A'],
  ['A', 'N'],
  ['N', 'A'],
  ...Array<[K, K]>(7).fill(['N', 'N']),
];

export const duetConfig = z.object({
  turns: z.number().int().min(5).max(15).default(9),
  packs: packSelection.default({ builtin: ['codewords-fa'], custom: [] }),
});
export type DuetConfig = z.infer<typeof duetConfig>;

export const duetAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('clue'), word: z.string().trim().min(1).max(30), count: z.number().int().min(0).max(9) }),
  z.object({ type: z.literal('reveal'), index: z.number().int().min(0).max(24) }),
  z.object({ type: z.literal('endTurn') }),
]);
export type DuetAction = z.infer<typeof duetAction>;

export interface DuetState {
  local: boolean;
  players: [PlayerId, PlayerId];
  all: Player[];
  words: string[];
  keys: [K[], K[]];
  found: boolean[];
  /** bystander marks: cell was neutral for the side that gave the clue */
  neutral: [boolean[], boolean[]];
  giver: 0 | 1;
  phase: 'clue' | 'guess' | 'over';
  clue: { word: string; count: number } | null;
  turnsLeft: number;
  outcome: 'won' | 'assassin' | 'time' | null;
}

export interface DuetView {
  phase: DuetState['phase'];
  players: Player[];
  seats: [PlayerId, PlayerId];
  words: string[];
  /** my own half of the key */
  myKey: K[] | null;
  mySide: 0 | 1 | null;
  found: boolean[];
  neutral: [boolean[], boolean[]];
  giver: PlayerId;
  clue: DuetState['clue'];
  turnsLeft: number;
  agentsLeft: number;
  outcome: DuetState['outcome'];
  fullKey: [K[], K[]] | null;
}

const agentCount = (s: DuetState) => s.words.filter((_, i) => (s.keys[0][i] === 'G' || s.keys[1][i] === 'G') && !s.found[i]).length;

function nextTurn(s: DuetState) {
  s.turnsLeft--;
  s.clue = null;
  if (s.turnsLeft <= 0) {
    s.phase = 'over';
    s.outcome = 'time';
    return;
  }
  s.giver = s.giver === 0 ? 1 : 0;
  s.phase = 'clue';
}

export const duet: GameModule<DuetConfig, DuetState, DuetAction, DuetView> = {
  id: 'board.duet',
  family: 'team-board',
  meta: META['board.duet'],
  configSchema: duetConfig,
  actionSchema: duetAction,
  defaultConfig: duetConfig.parse({}),
  setup(players, cfg, rng, opts) {
    const cells = rng.shuffle(DUET_CELLS);
    return {
      local: opts.local,
      players: [players[0]!.id, players[1]!.id],
      all: players,
      words: rng.sample([...new Set(itemsOf('words', cfg.packs).map((w) => w.word))], 25),
      keys: [cells.map((c) => c[0]), cells.map((c) => c[1])],
      found: Array(25).fill(false),
      neutral: [Array(25).fill(false), Array(25).fill(false)],
      giver: 0,
      phase: 'clue',
      clue: null,
      turnsLeft: cfg.turns,
      outcome: null,
    };
  },
  reduce(state, action, actor) {
    const s = clone(state);
    const giverId = s.players[s.giver];
    const guesserId = s.players[s.giver === 0 ? 1 : 0];
    switch (action.type) {
      case 'clue':
        if (s.phase !== 'clue' || actor !== giverId) return state;
        s.clue = { word: action.word.split(/\s+/)[0]!, count: action.count };
        s.phase = 'guess';
        return s;
      case 'reveal': {
        if (s.phase !== 'guess' || actor !== guesserId || s.found[action.index]) return state;
        const k = s.keys[s.giver][action.index]!;
        if (k === 'A') {
          s.phase = 'over';
          s.outcome = 'assassin';
          return s;
        }
        if (k === 'N') {
          s.neutral[s.giver][action.index] = true;
          nextTurn(s);
          return s;
        }
        s.found[action.index] = true;
        if (agentCount(s) === 0) {
          s.phase = 'over';
          s.outcome = 'won';
        }
        return s;
      }
      case 'endTurn':
        if (s.phase !== 'guess' || actor !== guesserId) return state;
        nextTurn(s);
        return s;
      default:
        return state;
    }
  },
  viewFor(s, viewer) {
    const side = viewer === s.players[0] ? 0 : viewer === s.players[1] ? 1 : null;
    return {
      phase: s.phase,
      players: s.all,
      seats: s.players,
      words: s.words,
      myKey: side == null ? null : s.keys[side],
      mySide: side,
      found: s.found,
      neutral: s.neutral,
      giver: s.players[s.giver],
      clue: s.clue,
      turnsLeft: s.turnsLeft,
      agentsLeft: agentCount(s),
      outcome: s.outcome,
      fullKey: s.phase === 'over' ? s.keys : null,
    };
  },
  result(s) {
    if (s.phase !== 'over') return null;
    const won = s.outcome === 'won';
    return {
      winners: won ? [...s.players] : [],
      title: { k: `duet.result.${s.outcome}` },
      lines: [{ k: 'duet.agentsLeft', p: { n: agentCount(s) } }],
      scores: won ? { [s.players[0]]: 3, [s.players[1]]: 3 } : {},
    };
  },
  pending: (s) => (s.phase === 'clue' ? [s.players[s.giver]] : s.phase === 'guess' ? [s.players[s.giver === 0 ? 1 : 0]] : []),
  validate: (_c, n) => (n !== 2 ? { k: 'duet.err.two' } : null),
  screens: { Setup: DuetSetup, Play: DuetPlay },
};
