import { z } from 'zod';
import type { Rng } from '@/core/engine/rng';
import {
  clone,
  GameError,
  type Ctx,
  type GameMeta,
  type GameModule,
  type GameResult,
  type Msg,
  type Player,
  type PlayerId,
  type SetupOptions,
  type SystemAction,
} from '@/core/engine/types';
import { infoRoleSchema, type InfoRole } from '@/custom/schemas';
import { sameAnswer } from '@/lib/normalize';

/**
 * Shared core of the hidden-word family (§6-الف):
 * deal secret → timed question round → vote → guess chance for the caught one → score.
 * Roles are pure data (§7.2: sees / knows / win); there are no per-role `if`s here.
 */

export const CITIZEN: InfoRole = infoRoleSchema.parse({
  id: 'citizen',
  nameFa: 'شهروند',
  emoji: '🙂',
  team: 'citizens',
  sees: 'secret',
  count: { min: 0, max: 16 },
  descriptionFa: 'راز را می‌دانی. با سؤال‌های هوشمندانه جاسوس را پیدا کن ولی راز را لو نده.',
});
export const SPY: InfoRole = infoRoleSchema.parse({
  id: 'spy',
  nameFa: 'جاسوس',
  emoji: '🕵️',
  team: 'spies',
  sees: 'none',
  onEliminated: 'guessSecret',
  count: { min: 1, max: 3 },
  descriptionFa: 'راز را نمی‌دانی. از حرف بقیه حدس بزن و لو نرو.',
});
export const TOPIC_SPY: InfoRole = {
  ...SPY,
  sees: 'category',
  descriptionFa: 'فقط دسته را می‌دانی، نه کلمه را.',
};
export const INFILTRATOR: InfoRole = infoRoleSchema.parse({
  id: 'infiltrator',
  nameFa: 'نفوذی',
  emoji: '🫥',
  team: 'spies',
  sees: 'similar',
  selfAware: false,
  onEliminated: 'guessSecret',
  count: { min: 1, max: 3 },
  descriptionFa:
    'کلمه‌ای شبیه کلمه‌ی بقیه داری و خودت خبر نداری. اگر حذف شوی، یک فرصت داری کلمه‌ی بقیه را حدس بزنی.',
});
export const BLANK: InfoRole = infoRoleSchema.parse({
  id: 'blank',
  nameFa: 'بی‌کلمه',
  emoji: '⬜',
  team: 'spies',
  sees: 'none',
  win: 'solo',
  onEliminated: 'guessSecret',
  count: { min: 0, max: 2 },
  descriptionFa: 'هیچ کلمه‌ای نداری. اگر حذف شوی و کلمه را درست حدس بزنی، تنهایی می‌بری.',
});
/** example custom role from §7.2 */
export const WITNESS: InfoRole = infoRoleSchema.parse({
  id: 'witness',
  nameFa: 'شاهد',
  emoji: '👁️',
  team: 'citizens',
  sees: 'secret',
  knows: ['spy'],
  onEliminated: 'spyGuessesWitness',
  count: { min: 0, max: 1 },
  descriptionFa: 'جاسوس را می‌شناسد ولی نباید لو برود.',
});

export interface Assign {
  roleId: string;
  word: string | null;
  category: string | null;
  subrole: string | null;
  grid: string[] | null;
  knows: PlayerId[];
}

export interface Deal {
  roles: { role: InfoRole; n: number }[];
  secret: string;
  similar: string | null;
  category: string | null;
  grid: string[] | null;
  /** list shown as reference and used for the guess; null = free text guess */
  guessOptions: string[] | null;
  /** per-location roles for «جاسوس با نقش» */
  subroles: string[] | null;
}

export type Phase = 'reveal' | 'discuss' | 'vote' | 'guess' | 'witness' | 'over';
type Outcome = {
  team: 'citizens' | 'spies' | 'solo';
  soloId: PlayerId | null;
  reason: string;
  guess: string | null;
};

export interface HWState {
  local: boolean;
  hostId: PlayerId;
  players: Player[];
  roleDefs: InfoRole[];
  assign: Record<PlayerId, Assign>;
  secret: string;
  guessOptions: string[] | null;
  phase: Phase;
  acked: PlayerId[];
  alive: PlayerId[];
  eliminated: PlayerId[];
  round: number;
  roundSeconds: number;
  endsAt: number | null;
  voteMode: 'secret' | 'host';
  elimination: 'single' | 'multi';
  spyGuessAnytime: boolean;
  votes: Record<PlayerId, PlayerId>;
  ties: number;
  /** after a tie, the re-vote is only between these players */
  candidates: PlayerId[] | null;
  lastTally: Record<PlayerId, number> | null;
  lastOut: PlayerId | null;
  notice: Msg | null;
  firstAsker: PlayerId;
  guesser: PlayerId | null;
  guessReason: 'caught' | 'declared' | null;
  outcome: Outcome | null;
}

export const baseConfig = {
  roundSeconds: z.number().int().min(0).max(1800).default(300),
  voteMode: z.enum(['secret', 'host']).default('secret'),
  /** custom information roles (§7.2) with how many of each */
  extraRoles: z
    .array(z.object({ role: infoRoleSchema, n: z.number().int().min(0).max(4) }))
    .max(6)
    .default([]),
};

export const hwAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ack') }),
  z.object({ type: z.literal('startVote') }),
  z.object({ type: z.literal('vote'), target: z.string() }),
  z.object({ type: z.literal('hostEliminate'), target: z.string() }),
  z.object({ type: z.literal('declareGuess') }),
  z.object({ type: z.literal('guess'), answer: z.string().max(60) }),
  z.object({ type: z.literal('witnessGuess'), target: z.string() }),
]);
export type HWAction = z.infer<typeof hwAction>;

export interface HWModeDef<C> {
  meta: GameMeta;
  configSchema: z.ZodType<C>;
  defaultConfig: C;
  elimination: 'single' | 'multi';
  spyGuessAnytime: boolean;
  deal(config: C, rng: Rng, playerCount: number): Deal;
  validate?(config: C, playerCount: number): Msg | null;
  screens: GameModule<C, HWState, HWAction, HWView>['screens'];
}

type BaseCfg = {
  roundSeconds: number;
  voteMode: 'secret' | 'host';
  extraRoles: { role: InfoRole; n: number }[];
};

// ---------------------------------------------------------------- dealing

export function allRoles(deal: Deal, extra: BaseCfg['extraRoles'], playerCount: number) {
  const list = [...deal.roles, ...extra.filter((e) => e.n > 0)];
  const special = list.reduce((s, r) => s + r.n, 0);
  return { list, citizens: playerCount - special };
}

export function dealPlayers(players: Player[], deal: Deal, cfg: BaseCfg, rng: Rng) {
  const { list, citizens } = allRoles(deal, cfg.extraRoles, players.length);
  if (citizens < 0) throw new GameError('too-many-roles');
  const citizenRole = list.find((r) => r.role.id === CITIZEN.id)?.role ?? CITIZEN;
  const roleDefs: InfoRole[] = [
    citizenRole,
    ...list.map((r) => r.role).filter((r) => r.id !== citizenRole.id),
  ];
  const bag: string[] = [];
  for (const r of list) if (r.role.id !== citizenRole.id) for (let i = 0; i < r.n; i++) bag.push(r.role.id);
  while (bag.length < players.length) bag.push(citizenRole.id);
  const order = rng.shuffle(bag);
  const subroles = deal.subroles ? rng.shuffle(deal.subroles) : null;
  const assign: Record<PlayerId, Assign> = {};
  let sub = 0;
  players.forEach((p, i) => {
    const role = roleDefs.find((r) => r.id === order[i])!;
    const word = role.sees === 'secret' ? deal.secret : role.sees === 'similar' ? deal.similar : null;
    const category = role.sees === 'none' ? null : deal.category;
    const subrole = subroles && role.sees === 'secret' ? subroles[sub++ % subroles.length]! : null;
    assign[p.id] = { roleId: role.id, word, category, subrole, grid: deal.grid, knows: [] };
  });
  for (const p of players) {
    const role = roleDefs.find((r) => r.id === assign[p.id]!.roleId)!;
    assign[p.id]!.knows = players
      .filter((o) => o.id !== p.id && role.knows.includes(assign[o.id]!.roleId))
      .map((o) => o.id);
  }
  return { roleDefs, assign };
}

// ---------------------------------------------------------------- helpers

const roleOf = (s: HWState, id: PlayerId) => s.roleDefs.find((r) => r.id === s.assign[id]?.roleId) ?? CITIZEN;
const isSpyTeam = (s: HWState, id: PlayerId) => roleOf(s, id).team === 'spies';
const hostOk = (s: HWState, actor: PlayerId) => s.local || actor === s.hostId;

function finish(s: HWState, team: Outcome['team'], reason: string, extra: Partial<Outcome> = {}): HWState {
  s.phase = 'over';
  s.endsAt = null;
  s.outcome = { team, reason, soloId: null, guess: null, ...extra };
  return s;
}

function citizensWin(s: HWState, reason: string, caught: PlayerId | null): HWState {
  const witnessInPlay = s.players.some((p) => roleOf(s, p.id).onEliminated === 'spyGuessesWitness');
  if (witnessInPlay) {
    const spies = s.players.filter((p) => isSpyTeam(s, p.id)).map((p) => p.id);
    s.phase = 'witness';
    s.guesser = caught && isSpyTeam(s, caught) ? caught : (spies[0] ?? null);
    s.notice = { k: 'hw.notice.witness' };
    if (s.guesser) return s;
  }
  return finish(s, 'citizens', reason);
}

function startDiscuss(s: HWState, now: number) {
  s.phase = 'discuss';
  s.votes = {};
  s.candidates = null;
  s.endsAt = s.roundSeconds > 0 ? now + s.roundSeconds * 1000 : null;
}

function checkMulti(s: HWState, now: number): HWState {
  const spies = s.alive.filter((id) => isSpyTeam(s, id)).length;
  const citizens = s.alive.length - spies;
  if (spies === 0) return citizensWin(s, 'hw.reason.allFound', null);
  if (spies >= citizens) return finish(s, 'spies', 'hw.reason.outnumber');
  s.round++;
  s.ties = 0;
  startDiscuss(s, now);
  return s;
}

function eliminate(s: HWState, target: PlayerId, now: number): HWState {
  s.lastOut = target;
  s.candidates = null;
  s.alive = s.alive.filter((id) => id !== target);
  s.eliminated.push(target);
  s.votes = {};
  const role = roleOf(s, target);
  if (role.onEliminated === 'guessSecret') {
    s.phase = 'guess';
    s.guesser = target;
    s.guessReason = 'caught';
    s.endsAt = null;
    return s;
  }
  if (s.elimination === 'single') {
    return role.team === 'spies'
      ? citizensWin(s, 'hw.reason.caught', target)
      : finish(s, 'spies', 'hw.reason.wrongVote');
  }
  return checkMulti(s, now);
}

function tally(s: HWState, now: number): HWState {
  const counts: Record<PlayerId, number> = {};
  for (const t of Object.values(s.votes)) counts[t] = (counts[t] ?? 0) + 1;
  s.lastTally = counts;
  const max = Math.max(...Object.values(counts));
  const top = Object.keys(counts).filter((id) => counts[id] === max);
  if (top.length === 1) {
    s.notice = null;
    return eliminate(s, top[0]!, now);
  }
  s.ties++;
  s.votes = {};
  if (s.ties >= 2) {
    s.notice = { k: 'hw.notice.tieTwice' };
    if (s.elimination === 'single') return finish(s, 'spies', 'hw.reason.tie');
    s.round++;
    s.ties = 0;
    startDiscuss(s, now);
    return s;
  }
  // re-vote only between the tied players
  s.candidates = top;
  s.notice = { k: 'hw.notice.tie' };
  return s;
}

// ---------------------------------------------------------------- module factory

export function setupHW(
  players: Player[],
  deal: Deal,
  cfg: BaseCfg,
  def: Pick<HWModeDef<unknown>, 'elimination' | 'spyGuessAnytime'>,
  rng: Rng,
  opts: SetupOptions,
): HWState {
  const { roleDefs, assign } = dealPlayers(players, deal, cfg, rng);
  return {
    local: opts.local,
    hostId: opts.hostId,
    players,
    roleDefs,
    assign,
    secret: deal.secret,
    guessOptions: deal.guessOptions,
    phase: 'reveal',
    acked: [],
    alive: players.map((p) => p.id),
    eliminated: [],
    round: 1,
    roundSeconds: cfg.roundSeconds,
    endsAt: null,
    voteMode: cfg.voteMode,
    elimination: def.elimination,
    spyGuessAnytime: def.spyGuessAnytime,
    votes: {},
    ties: 0,
    candidates: null,
    lastTally: null,
    lastOut: null,
    notice: null,
    firstAsker: rng.pick(players).id,
    guesser: null,
    guessReason: null,
    outcome: null,
  };
}

export function reduceHW(
  state: HWState,
  action: HWAction | SystemAction,
  actor: PlayerId,
  ctx: Ctx,
): HWState {
  const s = clone(state);
  const now = ctx.now;
  switch (action.type) {
    case 'ack': {
      if (s.phase !== 'reveal' || s.acked.includes(actor)) return state;
      s.acked.push(actor);
      if (s.acked.length >= s.players.length) startDiscuss(s, now);
      return s;
    }
    case '$timeout': {
      if (s.phase !== 'discuss') return state;
      s.phase = 'vote';
      s.endsAt = null;
      s.notice = { k: 'hw.notice.timeUp' };
      return s;
    }
    case 'startVote': {
      if (s.phase !== 'discuss' || !hostOk(s, actor)) return state;
      s.phase = 'vote';
      s.endsAt = null;
      s.notice = null;
      return s;
    }
    case 'vote': {
      if (s.phase !== 'vote' || s.voteMode !== 'secret') return state;
      if (!s.alive.includes(actor) || !s.alive.includes(action.target) || action.target === actor)
        return state;
      if (s.candidates && !s.candidates.includes(action.target)) return state;
      s.votes[actor] = action.target;
      if (s.alive.every((id) => s.votes[id])) return tally(s, now);
      return s;
    }
    case 'hostEliminate': {
      if (s.phase !== 'vote' || !hostOk(s, actor) || !s.alive.includes(action.target)) return state;
      if (s.candidates && !s.candidates.includes(action.target)) return state;
      return eliminate(s, action.target, now);
    }
    case 'declareGuess': {
      if (s.phase !== 'discuss' || !s.spyGuessAnytime || !s.alive.includes(actor)) return state;
      const role = roleOf(s, actor);
      if (role.team !== 'spies' || role.onEliminated !== 'guessSecret') return state;
      s.phase = 'guess';
      s.guesser = actor;
      s.guessReason = 'declared';
      s.endsAt = null;
      return s;
    }
    case 'guess': {
      if (s.phase !== 'guess' || actor !== s.guesser) return state;
      const correct = sameAnswer(action.answer, s.secret);
      const role = roleOf(s, actor);
      if (correct) {
        return role.win === 'solo'
          ? finish(s, 'solo', 'hw.reason.soloGuess', { soloId: actor, guess: action.answer })
          : finish(s, 'spies', 'hw.reason.guessed', { guess: action.answer });
      }
      s.notice = { k: 'hw.notice.wrongGuess', p: { guess: action.answer } };
      if (s.guessReason === 'declared' || s.elimination === 'single') {
        const r = citizensWin(s, 'hw.reason.wrongGuess', actor);
        if (r.outcome) r.outcome.guess = action.answer;
        return r;
      }
      s.guesser = null;
      return checkMulti(s, now);
    }
    case 'witnessGuess': {
      if (s.phase !== 'witness' || actor !== s.guesser) return state;
      const found = roleOf(s, action.target).onEliminated === 'spyGuessesWitness';
      return found
        ? finish(s, 'spies', 'hw.reason.witnessFound')
        : finish(s, 'citizens', 'hw.reason.witnessSafe');
    }
  }
}

// ---------------------------------------------------------------- views

export interface HWView {
  phase: Phase;
  round: number;
  endsAt: number | null;
  players: Player[];
  alive: PlayerId[];
  acked: PlayerId[];
  voted: PlayerId[];
  myVote: PlayerId | null;
  /** tie re-vote: only these can be voted for */
  candidates: PlayerId[] | null;
  lastTally: Record<PlayerId, number> | null;
  lastOut: { id: PlayerId; roleName: string; emoji: string } | null;
  notice: Msg | null;
  firstAsker: PlayerId;
  voteMode: 'secret' | 'host';
  elimination: 'single' | 'multi';
  /** the public list of possible secrets (locations / grid / category words) */
  reference: string[] | null;
  grid: string[] | null;
  me: {
    roleName: string | null;
    emoji: string;
    description: string;
    team: 'citizens' | 'spies' | null;
    word: string | null;
    category: string | null;
    subrole: string | null;
    knows: { id: PlayerId; roleName: string }[];
    canDeclareGuess: boolean;
  } | null;
  guess: { guesser: PlayerId; mine: boolean; options: string[] | null } | null;
  witness: { guesser: PlayerId; mine: boolean } | null;
  outcome:
    | (Outcome & {
        secret: string;
        roles: { id: PlayerId; roleName: string; emoji: string; word: string | null }[];
      })
    | null;
}

export function viewHW(s: HWState, viewer: PlayerId | 'public'): HWView {
  const a = viewer === 'public' ? null : s.assign[viewer];
  const role = a ? roleOf(s, viewer as PlayerId) : null;
  const over = s.phase === 'over';
  const lastOutRole = s.lastOut ? roleOf(s, s.lastOut) : null;
  return {
    phase: s.phase,
    round: s.round,
    endsAt: s.endsAt,
    players: s.players,
    alive: s.alive,
    acked: s.acked,
    voted: Object.keys(s.votes),
    myVote: viewer === 'public' ? null : (s.votes[viewer] ?? null),
    candidates: s.candidates,
    lastTally: s.lastTally,
    lastOut:
      s.lastOut && lastOutRole
        ? s.elimination === 'multi' || over || s.phase === 'guess'
          ? { id: s.lastOut, roleName: lastOutRole.nameFa, emoji: lastOutRole.emoji }
          : { id: s.lastOut, roleName: '', emoji: '❔' }
        : null,
    notice: s.notice,
    firstAsker: s.firstAsker,
    voteMode: s.voteMode,
    elimination: s.elimination,
    reference: s.guessOptions,
    grid: a?.grid ?? s.assign[s.players[0]!.id]?.grid ?? null,
    me:
      a && role
        ? {
            roleName: role.selfAware ? role.nameFa : null,
            emoji: role.selfAware ? role.emoji : '🃏',
            description: role.selfAware ? role.descriptionFa : '',
            team: role.selfAware ? role.team : null,
            word: a.word,
            category: a.category,
            subrole: a.subrole,
            knows: a.knows.map((id) => ({ id, roleName: roleOf(s, id).nameFa })),
            canDeclareGuess:
              s.phase === 'discuss' &&
              s.spyGuessAnytime &&
              s.alive.includes(viewer as PlayerId) &&
              role.team === 'spies' &&
              role.onEliminated === 'guessSecret',
          }
        : null,
    guess:
      s.phase === 'guess' && s.guesser
        ? {
            guesser: s.guesser,
            mine: viewer === s.guesser,
            options: viewer === s.guesser ? s.guessOptions : null,
          }
        : null,
    witness: s.phase === 'witness' && s.guesser ? { guesser: s.guesser, mine: viewer === s.guesser } : null,
    outcome:
      over && s.outcome
        ? {
            ...s.outcome,
            secret: s.secret,
            roles: s.players.map((p) => {
              const r = roleOf(s, p.id);
              return { id: p.id, roleName: r.nameFa, emoji: r.emoji, word: s.assign[p.id]!.word };
            }),
          }
        : null,
  };
}

export function resultHW(s: HWState): GameResult | null {
  if (s.phase !== 'over' || !s.outcome) return null;
  const o = s.outcome;
  const spies = s.players.filter((p) => isSpyTeam(s, p.id)).map((p) => p.id);
  const winners =
    o.team === 'solo'
      ? [o.soloId!]
      : o.team === 'spies'
        ? spies
        : s.players.map((p) => p.id).filter((id) => !spies.includes(id));
  const pts = o.team === 'solo' ? 3 : o.team === 'spies' ? 2 : 1;
  const scores: Record<PlayerId, number> = {};
  for (const id of winners) scores[id] = pts;
  return {
    winners,
    title: {
      k:
        o.team === 'citizens'
          ? 'hw.result.citizens'
          : o.team === 'spies'
            ? 'hw.result.spies'
            : 'hw.result.solo',
    },
    lines: [{ k: o.reason }],
    secret: s.secret,
    scores,
    reveal: s.players.map((p) => ({
      playerId: p.id,
      label: `${roleOf(s, p.id).emoji} ${roleOf(s, p.id).nameFa}`,
    })),
    highlights: o.team === 'citizens' ? [] : winners.map((id) => ({ key: 'spy-win', playerId: id })),
  };
}

export function pendingHW(s: HWState): PlayerId[] {
  if (s.phase === 'reveal') return s.players.map((p) => p.id).filter((id) => !s.acked.includes(id));
  if (s.phase === 'vote' && s.voteMode === 'secret') return s.alive.filter((id) => !s.votes[id]);
  if ((s.phase === 'guess' || s.phase === 'witness') && s.guesser) return [s.guesser];
  return [];
}

export function makeHWModule<C extends BaseCfg>(def: HWModeDef<C>): GameModule<C, HWState, HWAction, HWView> {
  return {
    id: def.meta.id,
    family: 'hidden-word',
    meta: def.meta,
    configSchema: def.configSchema,
    actionSchema: hwAction,
    defaultConfig: def.defaultConfig,
    setup: (players, config, rng, opts) =>
      setupHW(players, def.deal(config, rng, players.length), config, def, rng, opts),
    reduce: reduceHW,
    viewFor: viewHW,
    result: resultHW,
    pending: pendingHW,
    deadline: (s) => (s.phase === 'discuss' ? s.endsAt : null),
    validate: (config, n) => {
      if (n < def.meta.minPlayers) return { k: 'err.minPlayers', p: { n: def.meta.minPlayers } };
      if (n > def.meta.maxPlayers) return { k: 'err.maxPlayers', p: { n: def.meta.maxPlayers } };
      const custom = def.validate?.(config, n);
      if (custom) return custom;
      const probe = def.deal(
        config,
        {
          next: () => 0,
          int: (a) => a,
          pick: (x) => x[0]!,
          shuffle: (x) => [...x],
          sample: (x, k) => x.slice(0, k),
          chance: () => false,
        },
        n,
      );
      const { list, citizens } = allRoles(probe, config.extraRoles, n);
      const spies = list.filter((r) => r.role.team === 'spies').reduce((t, r) => t + r.n, 0);
      if (citizens < 0) return { k: 'err.tooManyRoles' };
      if (spies >= n - spies) return { k: 'err.tooManySpies' };
      return null;
    },
    screens: def.screens,
  };
}

export { type InfoRole };
