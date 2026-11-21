import { z } from 'zod';
import { itemsOf } from '@/content/builtin';
import { packSelection } from '@/content/schema';
import { clone, GameError, type GameModule, type Player, type PlayerId } from '@/core/engine/types';
import { compactFa } from '@/lib/normalize';
import { META } from '../meta';
import { makeTeams } from '../word-guess/core';
import { CodewordsPlay, CodewordsSetup } from './codewords-ui';

/**
 * «رمزواژه»: 25 words, two teams. Only the two captains see the key card (on their own phones).
 * Captain gives a one-word clue + number; operatives reveal cards; neutral ends the turn, black loses.
 */
export type Color = 'red' | 'blue' | 'neutral' | 'black';

export const cwConfig = z.object({
  /** seconds per guessing turn, 0 = no timer */
  turnSeconds: z.number().int().min(0).max(600).default(0),
  packs: packSelection.default({ builtin: ['codewords-fa'], custom: [] }),
  /** host's team choice: player id → 0 (red) / 1 (blue); the rest are spread automatically */
  manualTeams: z.record(z.string(), z.number().int().min(0).max(1)).default({}),
  /** host's captain choice per team (falls back to a random team member) */
  captains: z.object({ red: z.string().optional(), blue: z.string().optional() }).default({}),
});
export type CWConfig = z.infer<typeof cwConfig>;

export const cwAction = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('clue'),
    word: z.string().trim().min(1).max(30),
    count: z.number().int().min(0).max(9),
  }),
  z.object({ type: z.literal('reveal'), index: z.number().int().min(0).max(24) }),
  z.object({ type: z.literal('endTurn') }),
]);
export type CWAction = z.infer<typeof cwAction>;

export interface CWState {
  local: boolean;
  hostId: PlayerId;
  players: Player[];
  teams: { red: PlayerId[]; blue: PlayerId[] };
  captains: { red: PlayerId; blue: PlayerId };
  words: string[];
  key: Color[];
  revealed: boolean[];
  turn: 'red' | 'blue';
  phase: 'clue' | 'guess' | 'over';
  clue: { word: string; count: number } | null;
  guessesLeft: number;
  endsAt: number | null;
  turnSeconds: number;
  winner: 'red' | 'blue' | null;
  reason: string | null;
  history: { team: 'red' | 'blue'; word: string; count: number }[];
}

export interface CWView {
  phase: CWState['phase'];
  players: Player[];
  teams: CWState['teams'];
  captains: CWState['captains'];
  words: string[];
  /** colours of revealed cards for everyone; the full key only for captains (and at the end) */
  colors: (Color | null)[];
  revealed: boolean[];
  turn: 'red' | 'blue';
  clue: CWState['clue'];
  guessesLeft: number;
  endsAt: number | null;
  myTeam: 'red' | 'blue' | null;
  amCaptain: boolean;
  left: { red: number; blue: number };
  winner: CWState['winner'];
  reason: string | null;
  history: CWState['history'];
  local: boolean;
}

const other = (t: 'red' | 'blue') => (t === 'red' ? 'blue' : 'red');
const teamOf = (s: CWState, p: PlayerId) =>
  s.teams.red.includes(p) ? 'red' : s.teams.blue.includes(p) ? 'blue' : null;
const remaining = (s: CWState, c: 'red' | 'blue') => s.key.filter((k, i) => k === c && !s.revealed[i]).length;

function endTurn(s: CWState, now: number) {
  s.turn = other(s.turn);
  s.phase = 'clue';
  s.clue = null;
  s.guessesLeft = 0;
  s.endsAt = null;
  void now;
}

export const codewords: GameModule<CWConfig, CWState, CWAction, CWView> = {
  id: 'board.codewords',
  family: 'team-board',
  meta: META['board.codewords'],
  configSchema: cwConfig,
  actionSchema: cwAction,
  defaultConfig: cwConfig.parse({}),
  setup(players, cfg, rng, opts) {
    const [red, blue] = makeTeams(players, 2, rng, cfg.manualTeams) as [PlayerId[], PlayerId[]];
    const captainOf = (team: PlayerId[], wanted?: string) =>
      wanted && team.includes(wanted) ? wanted : rng.pick(team);
    const first: 'red' | 'blue' = rng.chance(0.5) ? 'red' : 'blue';
    const key = rng.shuffle<Color>([
      ...Array<Color>(9).fill(first),
      ...Array<Color>(8).fill(other(first)),
      ...Array<Color>(7).fill('neutral'),
      'black',
    ]);
    return {
      local: opts.local,
      hostId: opts.hostId,
      players,
      teams: { red, blue },
      captains: { red: captainOf(red, cfg.captains.red), blue: captainOf(blue, cfg.captains.blue) },
      words: rng.sample([...new Set(itemsOf('words', cfg.packs).map((w) => w.word))], 25),
      key,
      revealed: Array(25).fill(false),
      turn: first,
      phase: 'clue',
      clue: null,
      guessesLeft: 0,
      endsAt: null,
      turnSeconds: cfg.turnSeconds,
      winner: null,
      reason: null,
      history: [],
    };
  },
  reduce(state, action, actor, ctx) {
    const s = clone(state);
    switch (action.type) {
      case 'clue': {
        if (s.phase !== 'clue' || !(actor === s.captains[s.turn] || s.local)) return state;
        const word = action.word.split(/\s+/)[0]!;
        if (s.words.some((w, i) => !s.revealed[i] && compactFa(w) === compactFa(word)))
          throw new GameError('clue-on-board');
        s.clue = { word, count: action.count };
        s.history.push({ team: s.turn, word, count: action.count });
        s.guessesLeft = action.count === 0 ? 25 : action.count + 1;
        s.phase = 'guess';
        s.endsAt = s.turnSeconds ? ctx.now + s.turnSeconds * 1000 : null;
        return s;
      }
      case 'reveal': {
        if (s.phase !== 'guess' || s.revealed[action.index]) return state;
        if (!s.local && (teamOf(s, actor) !== s.turn || actor === s.captains[s.turn])) return state;
        s.revealed[action.index] = true;
        const c = s.key[action.index]!;
        if (c === 'black') {
          s.winner = other(s.turn);
          s.reason = 'cw.reason.black';
          s.phase = 'over';
          return s;
        }
        for (const team of ['red', 'blue'] as const) {
          if (remaining(s, team) === 0) {
            s.winner = team;
            s.reason = 'cw.reason.allFound';
            s.phase = 'over';
            return s;
          }
        }
        if (c !== s.turn) endTurn(s, ctx.now);
        else if (--s.guessesLeft <= 0) endTurn(s, ctx.now);
        return s;
      }
      case 'endTurn':
        if (s.phase !== 'guess') return state;
        if (!s.local && (teamOf(s, actor) !== s.turn || actor === s.captains[s.turn])) return state;
        endTurn(s, ctx.now);
        return s;
      case '$timeout':
        if (s.phase !== 'guess') return state;
        endTurn(s, ctx.now);
        return s;
    }
  },
  viewFor(s, viewer) {
    const myTeam = viewer === 'public' ? null : teamOf(s, viewer);
    const amCaptain = viewer !== 'public' && (viewer === s.captains.red || viewer === s.captains.blue);
    const showKey = amCaptain || s.phase === 'over';
    return {
      phase: s.phase,
      players: s.players,
      teams: s.teams,
      captains: s.captains,
      words: s.words,
      colors: s.key.map((k, i) => (showKey || s.revealed[i] ? k : null)),
      revealed: s.revealed,
      turn: s.turn,
      clue: s.clue,
      guessesLeft: s.guessesLeft,
      endsAt: s.endsAt,
      myTeam,
      amCaptain,
      left: { red: remaining(s, 'red'), blue: remaining(s, 'blue') },
      winner: s.winner,
      reason: s.reason,
      history: s.history,
      local: s.local,
    };
  },
  result(s) {
    if (s.phase !== 'over' || !s.winner) return null;
    const winners = s.teams[s.winner];
    return {
      winners,
      title: { k: `cw.result.${s.winner}` },
      lines: [{ k: s.reason! }],
      scores: Object.fromEntries(winners.map((w) => [w, 2])),
      reveal: s.players.map((p) => ({
        playerId: p.id,
        label: `${teamOf(s, p.id) === 'red' ? '🟥' : '🟦'}${p.id === s.captains.red || p.id === s.captains.blue ? ' 🧠' : ''}`,
      })),
      highlights: [{ key: 'mvp', playerId: s.captains[s.winner] }],
    };
  },
  pending: (s) => (s.phase === 'clue' ? [s.captains[s.turn]] : []),
  deadline: (s) => (s.phase === 'guess' ? s.endsAt : null),
  validate: (_c, n) => (n < 4 ? { k: 'err.minPlayers', p: { n: 4 } } : null),
  screens: { Setup: CodewordsSetup, Play: CodewordsPlay },
};
