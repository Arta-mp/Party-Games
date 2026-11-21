import { z } from 'zod';
import { itemsOf } from '@/content/builtin';
import { packSelection } from '@/content/schema';
import { clone, type GameModule, type Player, type PlayerId } from '@/core/engine/types';
import { META } from '../meta';
import { InsiderPlay, InsiderSetup } from './insider-ui';

/**
 * «راهنمای پنهان»: the guide (public) answers yes/no questions about a secret word.
 * One hidden player also knows the word and steers the group. Find the word in time, then unmask them.
 */
export const insiderConfig = z.object({
  searchSeconds: z.number().int().min(60).max(900).default(300),
  discussSeconds: z.number().int().min(30).max(600).default(120),
  packs: packSelection.default({ builtin: [], custom: [] }),
});
export type InsiderConfig = z.infer<typeof insiderConfig>;

export const insiderAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ack') }),
  z.object({ type: z.literal('found'), finder: z.string() }),
  z.object({ type: z.literal('startVote') }),
  z.object({ type: z.literal('vote'), target: z.string() }),
]);
export type InsiderAction = z.infer<typeof insiderAction>;

type Phase = 'reveal' | 'search' | 'discuss' | 'vote' | 'over';
export interface InsiderState {
  local: boolean;
  hostId: PlayerId;
  players: Player[];
  guide: PlayerId;
  insider: PlayerId;
  word: string;
  phase: Phase;
  acked: PlayerId[];
  endsAt: number | null;
  cfg: InsiderConfig;
  finder: PlayerId | null;
  votes: Record<PlayerId, PlayerId>;
  outcome: 'notFound' | 'caught' | 'escaped' | null;
  tally: Record<PlayerId, number> | null;
}

export interface InsiderView {
  phase: Phase;
  players: Player[];
  guide: PlayerId;
  endsAt: number | null;
  finder: PlayerId | null;
  acked: PlayerId[];
  voted: PlayerId[];
  myVote: PlayerId | null;
  me: { role: 'guide' | 'insider' | 'common'; word: string | null } | null;
  /** the guide always sees it on the public screen in pass & play (they are the moderator) */
  outcome: { kind: NonNullable<InsiderState['outcome']>; insider: PlayerId; word: string; tally: Record<PlayerId, number> | null } | null;
  /** word revealed after it is found */
  word: string | null;
}

const canModerate = (s: InsiderState, actor: PlayerId) => s.local || actor === s.guide || actor === s.hostId;

export const insider: GameModule<InsiderConfig, InsiderState, InsiderAction, InsiderView> = {
  id: 'spy.insider',
  family: 'hidden-word',
  meta: META['spy.insider'],
  configSchema: insiderConfig,
  actionSchema: insiderAction,
  defaultConfig: insiderConfig.parse({}),
  setup(players, cfg, rng, opts) {
    const [guide, ins] = rng.sample(players, 2);
    return {
      local: opts.local,
      hostId: opts.hostId,
      players,
      guide: guide!.id,
      insider: ins!.id,
      word: rng.pick(itemsOf('words', cfg.packs)).word,
      phase: 'reveal',
      acked: [],
      endsAt: null,
      cfg,
      finder: null,
      votes: {},
      outcome: null,
      tally: null,
    };
  },
  reduce(state, action, actor, ctx) {
    const s = clone(state);
    switch (action.type) {
      case 'ack':
        if (s.phase !== 'reveal' || s.acked.includes(actor)) return state;
        s.acked.push(actor);
        if (s.acked.length === s.players.length) {
          s.phase = 'search';
          s.endsAt = ctx.now + s.cfg.searchSeconds * 1000;
        }
        return s;
      case '$timeout':
        if (s.phase === 'search') {
          s.phase = 'over';
          s.outcome = 'notFound';
          s.endsAt = null;
          return s;
        }
        if (s.phase === 'discuss') {
          s.phase = 'vote';
          s.endsAt = null;
          return s;
        }
        return state;
      case 'found':
        if (s.phase !== 'search' || !canModerate(s, actor) || !s.players.some((p) => p.id === action.finder)) return state;
        if (action.finder === s.guide) return state;
        s.finder = action.finder;
        s.phase = 'discuss';
        s.endsAt = ctx.now + s.cfg.discussSeconds * 1000;
        return s;
      case 'startVote':
        if (s.phase !== 'discuss' || !canModerate(s, actor)) return state;
        s.phase = 'vote';
        s.endsAt = null;
        return s;
      case 'vote': {
        if (s.phase !== 'vote' || action.target === actor || action.target === s.guide) return state;
        if (!s.players.some((p) => p.id === action.target)) return state;
        s.votes[actor] = action.target;
        if (s.players.every((p) => s.votes[p.id])) {
          const t: Record<PlayerId, number> = {};
          for (const v of Object.values(s.votes)) t[v] = (t[v] ?? 0) + 1;
          const max = Math.max(...Object.values(t));
          const top = Object.keys(t).filter((k) => t[k] === max);
          s.tally = t;
          s.outcome = top.length === 1 && top[0] === s.insider ? 'caught' : 'escaped';
          s.phase = 'over';
        }
        return s;
      }
    }
  },
  viewFor(s, viewer) {
    const role = viewer === 'public' ? null : viewer === s.guide ? 'guide' : viewer === s.insider ? 'insider' : 'common';
    return {
      phase: s.phase,
      players: s.players,
      guide: s.guide,
      endsAt: s.endsAt,
      finder: s.finder,
      acked: s.acked,
      voted: Object.keys(s.votes),
      myVote: viewer === 'public' ? null : (s.votes[viewer] ?? null),
      me: role ? { role, word: role === 'common' ? null : s.word } : null,
      word: s.finder || s.phase === 'over' ? s.word : null,
      outcome: s.phase === 'over' && s.outcome ? { kind: s.outcome, insider: s.insider, word: s.word, tally: s.tally } : null,
    };
  },
  result(s) {
    if (s.phase !== 'over' || !s.outcome) return null;
    const all = s.players.map((p) => p.id);
    const winners = s.outcome === 'notFound' ? [] : s.outcome === 'caught' ? all.filter((id) => id !== s.insider) : [s.insider];
    const scores: Record<PlayerId, number> = {};
    for (const w of winners) scores[w] = s.outcome === 'escaped' ? 3 : 1;
    return {
      winners,
      title: { k: `insider.result.${s.outcome}` },
      secret: s.word,
      scores,
      reveal: [
        { playerId: s.guide, label: '🧭 راهنما' },
        { playerId: s.insider, label: '🤫 خودی' },
      ],
      highlights: s.outcome === 'escaped' ? [{ key: 'spy-win', playerId: s.insider }] : [],
    };
  },
  pending(s) {
    if (s.phase === 'reveal') return s.players.map((p) => p.id).filter((id) => !s.acked.includes(id));
    if (s.phase === 'vote') return s.players.map((p) => p.id).filter((id) => !s.votes[id]);
    return [];
  },
  deadline: (s) => (s.phase === 'search' || s.phase === 'discuss' ? s.endsAt : null),
  validate: (_c, n) => (n < 4 ? { k: 'err.minPlayers', p: { n: 4 } } : n > 8 ? { k: 'err.maxPlayers', p: { n: 8 } } : null),
  screens: { Setup: InsiderSetup, Play: InsiderPlay },
};
