import { z } from 'zod';
import type { Rng } from '@/core/engine/rng';
import {
  clone,
  type Ctx,
  type GameResult,
  type Msg,
  type Player,
  type PlayerId,
  type SetupOptions,
  type SystemAction,
} from '@/core/engine/types';
import { abilityRoleSchema, DEFAULT_PRIORITY, type AbilityRole, type NightAbility } from '@/custom/schemas';
import { checkComposition, defaultComposition, type Composition } from './roles';

/**
 * Shared core of the social-deduction family (§6-ب): night/day cycle, teams, prioritised night
 * actions, lynch vote, win conditions. Roles are §7.3 data; nothing here knows a role by name.
 */
export type MafiaKind = 'auto' | 'moderated' | 'werewolf' | 'onenight';
export type Phase =
  'reveal' | 'night' | 'dawn' | 'day' | 'vote' | 'defense' | 'final' | 'revenge' | 'moderating' | 'over';

export const mafiaConfig = z.object({
  /** null = pick a sensible default for the player count */
  composition: z
    .array(z.object({ role: abilityRoleSchema, n: z.number().int().min(0).max(12) }))
    .nullable()
    .default(null),
  daySeconds: z.number().int().min(0).max(1200).default(240),
  revealOnDeath: z.boolean().default(false),
  /** Iranian style: players with at least half the votes defend themselves, then a final vote */
  defense: z.boolean().default(true),
  defenseSeconds: z.number().int().min(10).max(300).default(45),
  voteMode: z.enum(['secret', 'host']).default('secret'),
  /** host-overridable action priorities by role id (§7.3) */
  priorities: z.record(z.string(), z.number().int().min(0).max(100)).default({}),
});
export type MafiaConfig = z.infer<typeof mafiaConfig>;

export const mafiaAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ack') }),
  z.object({
    type: z.literal('night'),
    ability: z.number().int().min(-1).max(3),
    target: z.string().nullable(),
    /** multi-target abilities (predict) */
    targets: z.array(z.string()).max(3).optional(),
  }),
  z.object({ type: z.literal('shoot'), target: z.string() }),
  z.object({ type: z.literal('startFinal') }),
  z.object({ type: z.literal('continue') }),
  z.object({ type: z.literal('startVote') }),
  z.object({ type: z.literal('vote'), target: z.string() }),
  z.object({ type: z.literal('hostLynch'), target: z.string().nullable() }),
  z.object({ type: z.literal('revenge'), target: z.string() }),
  z.object({ type: z.literal('modToggle'), target: z.string() }),
  z.object({ type: z.literal('modEnd'), team: z.enum(['citizens', 'mafia', 'neutral']) }),
]);
export type MafiaAction = z.infer<typeof mafiaAction>;

export interface NightChoice {
  ability: number; // -1 = sleep / nothing
  target: PlayerId | null;
  targets?: PlayerId[];
}

export interface MafiaState {
  kind: MafiaKind;
  local: boolean;
  hostId: PlayerId;
  players: Player[];
  moderator: PlayerId | null;
  roles: AbilityRole[];
  assign: Record<PlayerId, string>;
  initialAssign: Record<PlayerId, string>;
  alive: PlayerId[];
  phase: Phase;
  night: number;
  acked: PlayerId[];
  choices: Record<PlayerId, NightChoice>;
  uses: Record<PlayerId, number[]>;
  bulletproofUsed: PlayerId[];
  notes: Record<PlayerId, Msg[]>;
  dawn: {
    killed: { id: PlayerId; role: string | null }[];
    saved: number;
    revealed: { id: PlayerId; role: string }[];
    silenced: PlayerId[];
    revived: PlayerId[];
  } | null;
  silenced: PlayerId[];
  endsAt: number | null;
  cfg: MafiaConfig;
  votes: Record<PlayerId, PlayerId>;
  /** players on trial after the first vote (defense) */
  defendants: PlayerId[];
  firstTally: Record<string, number> | null;
  /** guns handed out by the gunner: fired once during the day */
  guns: Record<PlayerId, 'real' | 'fake'>;
  dayShots: { by: PlayerId; target: PlayerId; died: boolean }[];
  lastLynch: { id: PlayerId | null; role: string | null; tally: Record<string, number> } | null;
  revengeBy: PlayerId | null;
  afterRevenge: 'night' | 'dawn' | 'day' | null;
  winner: { team: 'citizens' | 'mafia' | 'neutral'; solo: PlayerId | null; reason: string } | null;
  log: Msg[];
}

const SKIP = '$skip';

// ------------------------------------------------------------------ helpers
export const roleById = (s: MafiaState, id: string) => s.roles.find((r) => r.id === id)!;
export const roleOf = (s: MafiaState, p: PlayerId) => roleById(s, s.assign[p]!);
const name = (s: MafiaState, p: PlayerId) => s.players.find((x) => x.id === p)?.name ?? p;
const hostOk = (s: MafiaState, a: PlayerId) => s.local || a === s.hostId || a === s.moderator;

export function priorityOf(s: MafiaState, role: AbilityRole, ab: NightAbility): number {
  return s.cfg.priorities[role.id] ?? ab.priority ?? DEFAULT_PRIORITY[ab.action];
}

export function availableAbilities(
  s: MafiaState,
  p: PlayerId,
): { index: number; ability: NightAbility; usesLeft: number | null }[] {
  if (!s.alive.includes(p) || s.phase !== 'night') return [];
  const role = roleOf(s, p);
  return role.night
    .map((ability, index) => {
      const used = s.uses[p]?.[index] ?? 0;
      const usesLeft = ability.uses == null ? null : ability.uses - used;
      return { index, ability, usesLeft };
    })
    .filter(
      ({ ability, usesLeft }) =>
        ability.fromNight <= s.night &&
        (s.night - ability.fromNight) % ability.every === 0 &&
        (usesLeft == null || usesLeft > 0) &&
        (!ability.shared || isTeamLeader(s, p, ability.action)) &&
        (ability.target !== 'dead' || Object.keys(s.assign).some((d) => !s.alive.includes(d))),
    );
}

/**
 * Shared team actions (the mafia shot): if a living holder has a rank (godfather 3, nato 2, others 1),
 * only the highest-ranked one decides; equal ranks fall back to the player id. Rank-less teams
 * (werewolves) decide together by plurality.
 */
export function teamLeader(s: MafiaState, team: string, action: string): PlayerId | null {
  const holders = s.alive.filter((p) => {
    const r = roleOf(s, p);
    return r.team === team && r.night.some((a) => a.shared && a.action === action);
  });
  const ranked = holders.filter((p) => roleOf(s, p).rank > 0);
  if (!ranked.length) return null;
  return [...ranked].sort((a, b) => roleOf(s, b).rank - roleOf(s, a).rank || a.localeCompare(b))[0]!;
}

function isTeamLeader(s: MafiaState, p: PlayerId, action: string): boolean {
  const leader = teamLeader(s, roleOf(s, p).team, action);
  return leader == null || leader === p;
}

export function validTarget(s: MafiaState, actor: PlayerId, ab: NightAbility, target: PlayerId): boolean {
  if (!s.assign[target]) return false;
  if (ab.target === 'dead') return !s.alive.includes(target);
  if (!s.alive.includes(target)) return false;
  switch (ab.target) {
    case 'ownTeam':
      return target === actor || roleOf(s, target).team === roleOf(s, actor).team;
    case 'self':
      return target === actor;
    case 'other':
      return target !== actor;
    case 'teammate':
      return target !== actor && roleOf(s, target).team === roleOf(s, actor).team;
    default:
      return true;
  }
}

function teamOf(s: MafiaState, p: PlayerId) {
  return roleOf(s, p).team;
}

export function teammates(s: MafiaState, p: PlayerId): PlayerId[] {
  const role = roleOf(s, p);
  if (!role.knowsTeammates || role.team === 'citizens') return [];
  return Object.keys(s.assign).filter((o) => o !== p && teamOf(s, o) === role.team);
}

function note(s: MafiaState, p: PlayerId, m: Msg) {
  (s.notes[p] ??= []).push({ ...m, p: { ...m.p, night: s.night } });
}

// ------------------------------------------------------------------ setup

export function setupMafia(
  kind: MafiaKind,
  players: Player[],
  cfg: MafiaConfig,
  rng: Rng,
  opts: SetupOptions,
): MafiaState {
  const moderator = kind === 'moderated' ? opts.hostId : null;
  const seats = players.filter((p) => p.id !== moderator);
  const comp: Composition =
    cfg.composition ??
    defaultComposition(
      kind === 'werewolf' ? 'werewolf' : kind === 'onenight' ? 'onenight' : 'mafia',
      seats.length,
    );
  const base =
    comp.find((c) => c.role.team === 'citizens' && c.role.night.length === 0)?.role ??
    defaultComposition('mafia', 5).find((c) => c.role.id === 'citizen')!.role;
  const roles: AbilityRole[] = [
    ...new Map([...comp.map((c) => c.role), base].map((r) => [r.id, r])).values(),
  ];
  const bag: string[] = [];
  for (const c of comp) for (let i = 0; i < c.n; i++) bag.push(c.role.id);
  while (bag.length < seats.length) bag.push(base.id);
  const shuffled = rng.shuffle(bag.slice(0, seats.length));
  const assign: Record<PlayerId, string> = {};
  seats.forEach((p, i) => (assign[p.id] = shuffled[i]!));
  return {
    kind,
    local: opts.local,
    hostId: opts.hostId,
    players,
    moderator,
    roles,
    assign,
    initialAssign: { ...assign },
    alive: seats.map((p) => p.id),
    phase: 'reveal',
    night: 0,
    acked: [],
    choices: {},
    uses: {},
    bulletproofUsed: [],
    notes: {},
    dawn: null,
    silenced: [],
    endsAt: null,
    cfg,
    votes: {},
    defendants: [],
    firstTally: null,
    guns: {},
    dayShots: [],
    lastLynch: null,
    revengeBy: null,
    afterRevenge: null,
    winner: null,
    log: [],
  };
}

export function validateMafia(kind: MafiaKind, cfg: MafiaConfig, n: number): Msg | null {
  const seats = kind === 'moderated' ? n - 1 : n;
  const comp =
    cfg.composition ??
    defaultComposition(kind === 'werewolf' ? 'werewolf' : kind === 'onenight' ? 'onenight' : 'mafia', seats);
  const err = checkComposition(comp, seats);
  return err ? { k: err } : null;
}

// ------------------------------------------------------------------ night resolution

function startNight(s: MafiaState) {
  s.night++;
  s.phase = 'night';
  s.choices = {};
  s.endsAt = null;
  s.silenced = [];
}

interface Act {
  actor: PlayerId;
  role: AbilityRole;
  index: number;
  ab: NightAbility;
  target: PlayerId;
  targets: PlayerId[];
  prio: number;
}

/** plain role = no night action and no passive: the only kind a negotiator can recruit */
const isPlain = (r: AbilityRole) => r.night.length === 0 && r.passive.length === 0 && r.team === 'citizens';

function looksGuilty(r: AbilityRole) {
  return r.passive.includes('appearsInnocent')
    ? false
    : r.passive.includes('appearsGuilty')
      ? true
      : r.team === 'mafia';
}

export function resolveNight(s: MafiaState) {
  const acts: Act[] = [];
  // shared (team) abilities: one decision per team — plurality of teammates' picks
  const shared = new Map<string, { votes: Record<PlayerId, number>; reps: Act[] }>();
  for (const [actor, ch] of Object.entries(s.choices)) {
    if (ch.ability < 0 || !ch.target) continue;
    const role = roleOf(s, actor);
    const ab = role.night[ch.ability];
    if (!ab || !validTarget(s, actor, ab, ch.target)) continue;
    const targets = (ch.targets?.length ? ch.targets : [ch.target]).slice(0, ab.targets);
    const act: Act = {
      actor,
      role,
      index: ch.ability,
      ab,
      target: ch.target,
      targets,
      prio: priorityOf(s, role, ab),
    };
    if (ab.shared) {
      const key = `${role.team}:${ab.action}`;
      const g = shared.get(key) ?? { votes: {}, reps: [] };
      g.votes[ch.target] = (g.votes[ch.target] ?? 0) + 1;
      g.reps.push(act);
      shared.set(key, g);
    } else acts.push(act);
  }
  for (const g of shared.values()) {
    const max = Math.max(...Object.values(g.votes));
    const target = g.reps.find((r) => g.votes[r.target] === max)!.target; // earliest pick among the top
    const rep = [...g.reps].sort((a, b) => a.prio - b.prio)[0]!;
    acts.push({ ...rep, target });
  }
  acts.sort((a, b) => a.prio - b.prio || a.actor.localeCompare(b.actor));

  const blocked = new Set<PlayerId>();
  const protectedSet = new Set<PlayerId>();
  const killed = new Map<PlayerId, PlayerId>(); // victim → killer
  const revealed: { id: PlayerId; role: string }[] = [];
  const revived: PlayerId[] = [];
  let saved = 0;
  for (const a of acts) {
    if (blocked.has(a.actor) && !a.role.passive.includes('immuneToBlock')) {
      note(s, a.actor, { k: 'mafia.note.blocked' });
      continue;
    }
    if (a.ab.uses != null) {
      const u = (s.uses[a.actor] ??= []);
      u[a.index] = (u[a.index] ?? 0) + 1;
    }
    const targetRole = roleOf(s, a.target);
    switch (a.ab.action) {
      case 'block':
        if (!targetRole.passive.includes('immuneToBlock')) blocked.add(a.target);
        break;
      case 'silence':
        s.silenced.push(a.target);
        break;
      case 'protect':
        protectedSet.add(a.target);
        break;
      case 'swap': {
        const mine = s.assign[a.actor]!;
        s.assign[a.actor] = s.assign[a.target]!;
        s.assign[a.target] = mine;
        note(s, a.actor, {
          k: 'mafia.note.swapped',
          p: { name: name(s, a.target), role: roleOf(s, a.actor).nameFa },
        });
        break;
      }
      case 'kill':
        if (targetRole.passive.includes('nightImmune')) {
          saved++;
          break;
        }
        if (protectedSet.has(a.target)) {
          saved++;
          break;
        }
        if (targetRole.passive.includes('bulletproof') && !s.bulletproofUsed.includes(a.target)) {
          s.bulletproofUsed.push(a.target);
          saved++;
          break;
        }
        killed.set(a.target, a.actor);
        if (a.role.onWrongKill === 'selfDies' && targetRole.team === a.role.team)
          killed.set(a.actor, a.actor);
        break;
      case 'convert': {
        const mafiaRole =
          s.roles.find((r) => r.team === a.role.team && r.id === 'mafia') ??
          s.roles.find((r) => r.team === a.role.team && r.id !== a.role.id) ??
          a.role;
        if (!isPlain(targetRole)) {
          note(s, a.actor, { k: 'mafia.note.convertFailed', p: { name: name(s, a.target) } });
          break;
        }
        if (!s.roles.some((r) => r.id === mafiaRole.id)) s.roles.push(mafiaRole);
        {
          s.assign[a.target] = mafiaRole.id;
          note(s, a.target, { k: 'mafia.note.converted', p: { role: mafiaRole.nameFa } });
        }
        break;
      }
      case 'investigate': {
        if (s.kind === 'onenight') {
          note(s, a.actor, {
            k: 'mafia.note.sawRole',
            p: { name: name(s, a.target), role: targetRole.nameFa },
          });
          break;
        }
        const guilty = looksGuilty(targetRole);
        note(s, a.actor, {
          k: guilty ? 'mafia.note.guilty' : 'mafia.note.innocent',
          p: { name: name(s, a.target) },
        });
        break;
      }
      case 'reveal':
        revealed.push({ id: a.target, role: targetRole.nameFa });
        break;
      case 'expose':
        // only a real mafia is exposed, and exposing costs the actor their life
        if (targetRole.team === 'mafia') {
          revealed.push({ id: a.target, role: targetRole.nameFa });
          killed.set(a.actor, a.actor);
        } else note(s, a.actor, { k: 'mafia.note.notMafia', p: { name: name(s, a.target) } });
        break;
      case 'predict': {
        const n = a.targets.filter((t) => s.assign[t] && looksGuilty(roleOf(s, t))).length;
        note(s, a.actor, {
          k: 'mafia.note.predict',
          p: { names: a.targets.map((t) => name(s, t)).join('، '), n },
        });
        break;
      }
      case 'arm':
        s.guns[a.target] = a.ab.fake ? 'fake' : 'real';
        note(s, a.target, { k: 'mafia.note.gotGun' });
        break;
      case 'revive':
        revived.push(a.target);
        break;
    }
  }
  const victims = [...killed.keys()].filter((v) => s.alive.includes(v));
  s.alive = s.alive.filter((p) => !victims.includes(p));
  for (const r of revived) {
    if (!s.alive.includes(r)) {
      s.alive.push(r);
      note(s, r, { k: 'mafia.note.revived' });
    }
  }
  s.dawn = {
    killed: victims.map((id) => ({ id, role: s.cfg.revealOnDeath ? roleOf(s, id).nameFa : null })),
    saved,
    revealed,
    silenced: [...s.silenced],
    revived,
  };
  s.log.push({
    k: 'mafia.log.night',
    p: { n: s.night, names: victims.map((v) => name(s, v)).join('، ') || '—' },
  });
  return victims;
}

// ------------------------------------------------------------------ win conditions

export function checkWin(s: MafiaState): MafiaState['winner'] {
  const mafia = s.alive.filter((p) => teamOf(s, p) === 'mafia').length;
  // independent serial killers (Zodiac) are a third side: nobody else wins while they live
  const killers = s.alive.filter((p) => roleOf(s, p).winCondition === 'lastStanding');
  const rest = s.alive.length - mafia;
  if (killers.length === 1 && s.alive.length <= 2)
    return { team: 'neutral', solo: killers[0]!, reason: 'mafia.reason.lastStanding' };
  if (killers.length > 0) return null;
  if (mafia === 0) return { team: 'citizens', solo: null, reason: 'mafia.reason.allMafiaGone' };
  if (mafia >= rest) return { team: 'mafia', solo: null, reason: 'mafia.reason.outnumber' };
  return null;
}

/** lynch-vote weight (the mayor's vote counts twice) */
const voteWeight = (s: MafiaState, p: PlayerId) => (roleOf(s, p).passive.includes('doubleVote') ? 2 : 1);

function weightedTally(s: MafiaState): Record<string, number> {
  const t: Record<string, number> = {};
  for (const [voter, target] of Object.entries(s.votes)) t[target] = (t[target] ?? 0) + voteWeight(s, voter);
  return t;
}

function finish(s: MafiaState, w: NonNullable<MafiaState['winner']>) {
  s.winner = w;
  s.phase = 'over';
  s.endsAt = null;
}

function onDeaths(s: MafiaState, dead: PlayerId[], next: 'night' | 'dawn' | 'day'): boolean {
  const hunter = dead.find((d) => roleOf(s, d).passive.includes('revengeKill'));
  if (hunter && s.alive.length > 0) {
    s.phase = 'revenge';
    s.revengeBy = hunter;
    s.afterRevenge = next;
    return true;
  }
  return false;
}

function startDay(s: MafiaState, now: number) {
  s.phase = 'day';
  s.votes = {};
  s.defendants = [];
  s.firstTally = null;
  s.endsAt = s.cfg.daySeconds > 0 ? now + s.cfg.daySeconds * 1000 : null;
}

function lynch(
  s: MafiaState,
  target: PlayerId | null,
  tally: Record<string, number>,
  now: number,
): MafiaState {
  s.lastLynch = { id: target, role: target && s.cfg.revealOnDeath ? roleOf(s, target).nameFa : null, tally };
  s.votes = {};
  if (s.kind === 'onenight') {
    // one vote decides everything, using the roles *after* the night's swaps
    const wolves = s.players.filter((p) => s.assign[p.id] && teamOf(s, p.id) === 'mafia').map((p) => p.id);
    if (target && roleOf(s, target).winCondition === 'lynched')
      finish(s, { team: 'neutral', solo: target, reason: 'mafia.reason.jester' });
    else if (target && teamOf(s, target) === 'mafia')
      finish(s, { team: 'citizens', solo: null, reason: 'mafia.reason.wolfLynched' });
    else if (wolves.length === 0 && !target)
      finish(s, { team: 'citizens', solo: null, reason: 'mafia.reason.noWolves' });
    else finish(s, { team: 'mafia', solo: null, reason: 'mafia.reason.wolvesSurvive' });
    s.lastLynch.role = target ? roleOf(s, target).nameFa : null;
    return s;
  }
  if (target) {
    s.alive = s.alive.filter((p) => p !== target);
    s.log.push({ k: 'mafia.log.lynch', p: { name: name(s, target) } });
    if (roleOf(s, target).winCondition === 'lynched') {
      finish(s, { team: 'neutral', solo: target, reason: 'mafia.reason.jester' });
      return s;
    }
    const w = checkWin(s);
    if (w) {
      finish(s, w);
      return s;
    }
    if (onDeaths(s, [target], 'night')) return s;
  }
  startNight(s);
  void now;
  return s;
}

function tallyVotes(s: MafiaState, now: number): MafiaState {
  const t = weightedTally(s);
  if (s.phase === 'vote' && s.cfg.defense && s.kind !== 'onenight') {
    // first round: anyone with at least half of the living players' votes goes on trial
    const need = Math.ceil(s.alive.length / 2);
    const accused = Object.keys(t).filter((k) => k !== SKIP && t[k]! >= need);
    s.firstTally = t;
    s.votes = {};
    if (accused.length === 0) return lynch(s, null, t, now);
    s.defendants = accused;
    s.phase = 'defense';
    s.endsAt = now + s.cfg.defenseSeconds * 1000 * accused.length;
    return s;
  }
  const pool = Object.keys(t).filter((k) => k !== SKIP && (s.phase !== 'final' || s.defendants.includes(k)));
  const max = Math.max(0, ...pool.map((k) => t[k]!));
  const top = pool.filter((k) => t[k] === max);
  const skipWins = (t[SKIP] ?? 0) > max;
  const target = top.length === 1 && max > 0 && !skipWins ? top[0]! : null;
  s.defendants = [];
  return lynch(s, target, t, now);
}

// ------------------------------------------------------------------ reducer

export function reduceMafia(
  state: MafiaState,
  action: MafiaAction | SystemAction,
  actor: PlayerId,
  ctx: Ctx,
): MafiaState {
  const s = clone(state);
  const now = ctx.now;
  switch (action.type) {
    case 'ack': {
      if (s.phase !== 'reveal' || s.acked.includes(actor) || !s.assign[actor]) return state;
      s.acked.push(actor);
      if (s.acked.length === Object.keys(s.assign).length) {
        if (s.kind === 'moderated') s.phase = 'moderating';
        else startNight(s);
      }
      return s;
    }
    case 'night': {
      if (s.phase !== 'night' || !s.alive.includes(actor) || s.choices[actor]) return state;
      if (action.ability >= 0) {
        const av = availableAbilities(s, actor).find((a) => a.index === action.ability);
        if (!av || !action.target || !validTarget(s, actor, av.ability, action.target)) return state;
        const extra = action.targets ?? [];
        if (extra.length > av.ability.targets || new Set(extra).size !== extra.length) return state;
        if (extra.some((t) => !validTarget(s, actor, av.ability, t))) return state;
      }
      s.choices[actor] = {
        ability: action.ability,
        target: action.ability >= 0 ? action.target : null,
        ...(action.ability >= 0 && action.targets?.length ? { targets: action.targets } : {}),
      };
      if (s.alive.every((p) => s.choices[p])) {
        const dead = resolveNight(s);
        s.phase = 'dawn';
        const w = s.kind === 'onenight' ? null : checkWin(s);
        if (w) finish(s, w);
        else if (s.kind !== 'onenight' && onDeaths(s, dead, 'dawn')) {
          /* hunter shoots first */
        }
      }
      return s;
    }
    case 'continue': {
      if (s.phase !== 'dawn' || !hostOk(s, actor)) return state;
      startDay(s, now);
      return s;
    }
    case '$timeout': {
      if (s.phase === 'defense') {
        s.phase = 'final';
        s.endsAt = null;
        s.votes = {};
        return s;
      }
      if (s.phase !== 'day') return state;
      s.phase = 'vote';
      s.endsAt = null;
      return s;
    }
    case 'startFinal': {
      if (s.phase !== 'defense' || !hostOk(s, actor)) return state;
      s.phase = 'final';
      s.endsAt = null;
      s.votes = {};
      return s;
    }
    case 'shoot': {
      // a gun from the gunner: one shot during the day; holders don't know if it's real
      if (s.phase !== 'day' || !s.alive.includes(actor) || !s.guns[actor]) return state;
      if (!s.alive.includes(action.target) || action.target === actor) return state;
      const real = s.guns[actor] === 'real';
      delete s.guns[actor];
      const tr = roleOf(s, action.target);
      let died = false;
      if (real) {
        if (tr.passive.includes('bulletproof') && !s.bulletproofUsed.includes(action.target))
          s.bulletproofUsed.push(action.target);
        else {
          died = true;
          s.alive = s.alive.filter((p) => p !== action.target);
          s.log.push({ k: 'mafia.log.shot', p: { name: name(s, action.target) } });
        }
      }
      s.dayShots.push({ by: actor, target: action.target, died });
      if (died) {
        const w = checkWin(s);
        if (w) {
          finish(s, w);
          return s;
        }
        onDeaths(s, [action.target], 'day');
      }
      return s;
    }
    case 'startVote': {
      if (s.phase !== 'day' || !hostOk(s, actor)) return state;
      s.phase = 'vote';
      s.endsAt = null;
      return s;
    }
    case 'vote': {
      if ((s.phase !== 'vote' && s.phase !== 'final') || s.cfg.voteMode !== 'secret') return state;
      if (!s.alive.includes(actor) || s.votes[actor]) return state;
      if (action.target !== SKIP && (!s.alive.includes(action.target) || action.target === actor))
        return state;
      if (s.phase === 'final' && action.target !== SKIP && !s.defendants.includes(action.target))
        return state;
      s.votes[actor] = action.target;
      if (s.alive.every((p) => s.votes[p])) return tallyVotes(s, now);
      return s;
    }
    case 'hostLynch': {
      if ((s.phase !== 'vote' && s.phase !== 'final') || !hostOk(s, actor)) return state;
      if (action.target && !s.alive.includes(action.target)) return state;
      s.defendants = [];
      return lynch(s, action.target, {}, now);
    }
    case 'revenge': {
      if (s.phase !== 'revenge' || actor !== s.revengeBy || !s.alive.includes(action.target)) return state;
      s.alive = s.alive.filter((p) => p !== action.target);
      s.log.push({ k: 'mafia.log.revenge', p: { name: name(s, action.target) } });
      s.lastLynch = s.lastLynch ?? null;
      s.dawn = s.dawn
        ? {
            ...s.dawn,
            killed: [
              ...s.dawn.killed,
              { id: action.target, role: s.cfg.revealOnDeath ? roleOf(s, action.target).nameFa : null },
            ],
          }
        : s.dawn;
      s.revengeBy = null;
      const w = checkWin(s);
      if (w) {
        finish(s, w);
        return s;
      }
      if (s.afterRevenge === 'dawn') s.phase = 'dawn';
      else if (s.afterRevenge === 'day') s.phase = 'day';
      else startNight(s);
      return s;
    }
    case 'modToggle': {
      if (s.phase !== 'moderating' || (actor !== s.moderator && !s.local)) return state;
      if (!s.assign[action.target]) return state;
      s.alive = s.alive.includes(action.target)
        ? s.alive.filter((p) => p !== action.target)
        : [...s.alive, action.target];
      return s;
    }
    case 'modEnd': {
      if (s.phase !== 'moderating' || (actor !== s.moderator && !s.local)) return state;
      finish(s, { team: action.team, solo: null, reason: 'mafia.reason.moderator' });
      return s;
    }
  }
}

// ------------------------------------------------------------------ views

export interface MafiaView {
  kind: MafiaKind;
  phase: Phase;
  night: number;
  players: Player[];
  seats: PlayerId[];
  alive: PlayerId[];
  moderator: PlayerId | null;
  acked: PlayerId[];
  endsAt: number | null;
  voteMode: 'secret' | 'host';
  voted: PlayerId[];
  myVote: PlayerId | null;
  dawn: MafiaState['dawn'];
  lastLynch: MafiaState['lastLynch'];
  revengeBy: PlayerId | null;
  defense: boolean;
  defendants: PlayerId[];
  /** first-round vote counts (public, Iranian style) */
  firstTally: Record<string, number> | null;
  dayShots: MafiaState['dayShots'];
  /** roles of the dead, if the host reveals them */
  deadRoles: { id: PlayerId; role: string }[];
  me: {
    role: { id: string; nameFa: string; emoji: string; team: AbilityRole['team']; descriptionFa: string };
    teammates: { id: PlayerId; roleName: string }[];
    notes: Msg[];
    abilities: {
      index: number;
      action: NightAbility['action'];
      target: NightAbility['target'];
      targets: number;
      usesLeft: number | null;
    }[];
    /** who decides the team's shared action (godfather); null if not applicable */
    leader: PlayerId | null;
    hasGun: boolean;
    choice: NightChoice | null;
    teamPicks: { id: PlayerId; target: PlayerId | null }[];
    silenced: boolean;
  } | null;
  nightDone: PlayerId[];
  /** moderated mode: the script + all roles, only for the moderator */
  script: {
    order: { roleName: string; emoji: string; action: string; players: PlayerId[] }[];
    roles: { id: PlayerId; roleName: string; emoji: string; team: string }[];
  } | null;
  outcome: {
    winner: NonNullable<MafiaState['winner']>;
    roles: { id: PlayerId; roleName: string; emoji: string; team: string; initial: string }[];
    log: Msg[];
  } | null;
}

export function viewMafia(s: MafiaState, viewer: PlayerId | 'public'): MafiaView {
  const isSeat = viewer !== 'public' && !!s.assign[viewer];
  const role = isSeat ? roleOf(s, viewer as PlayerId) : null;
  const mates = isSeat ? teammates(s, viewer as PlayerId) : [];
  const dead = Object.keys(s.assign).filter((p) => !s.alive.includes(p));
  const isMod = viewer !== 'public' && viewer === s.moderator;
  return {
    kind: s.kind,
    phase: s.phase,
    night: s.night,
    players: s.players,
    seats: Object.keys(s.assign),
    alive: s.alive,
    moderator: s.moderator,
    acked: s.acked,
    endsAt: s.endsAt,
    voteMode: s.cfg.voteMode,
    voted: Object.keys(s.votes),
    myVote: viewer === 'public' ? null : (s.votes[viewer] ?? null),
    dawn: s.phase === 'night' ? null : s.dawn,
    lastLynch: s.lastLynch,
    revengeBy: s.revengeBy,
    defense: s.cfg.defense && s.kind !== 'onenight',
    defendants: s.defendants,
    firstTally: s.phase === 'defense' || s.phase === 'final' ? s.firstTally : null,
    dayShots: s.dayShots,
    deadRoles:
      s.cfg.revealOnDeath && s.kind !== 'moderated'
        ? dead.map((id) => ({ id, role: roleOf(s, id).nameFa }))
        : [],
    me:
      isSeat && role
        ? {
            role: {
              id: role.id,
              nameFa: role.nameFa,
              emoji: role.emoji,
              team: role.team,
              descriptionFa: role.descriptionFa,
            },
            teammates: mates.map((id) => ({ id, roleName: roleOf(s, id).nameFa })),
            notes: s.notes[viewer as PlayerId] ?? [],
            abilities: availableAbilities(s, viewer as PlayerId).map((a) => ({
              index: a.index,
              action: a.ability.action,
              target: a.ability.target,
              targets: a.ability.targets,
              usesLeft: a.usesLeft,
            })),
            leader: role.team === 'mafia' ? teamLeader(s, role.team, 'kill') : null,
            hasGun: !!s.guns[viewer as PlayerId] && s.alive.includes(viewer as PlayerId),
            choice: s.choices[viewer as PlayerId] ?? null,
            teamPicks:
              s.phase === 'night'
                ? mates
                    .filter((m) => s.alive.includes(m))
                    .map((m) => {
                      const c = s.choices[m];
                      const ab = c && c.ability >= 0 ? roleOf(s, m).night[c.ability] : null;
                      // only the shared shot is visible to teammates
                      return { id: m, target: ab?.shared ? c!.target : null };
                    })
                : [],
            silenced:
              s.silenced.includes(viewer as PlayerId) &&
              (s.phase === 'day' || s.phase === 'vote' || s.phase === 'dawn'),
          }
        : null,
    nightDone: s.phase === 'night' ? Object.keys(s.choices) : [],
    script: isMod || (s.local && s.kind === 'moderated' && viewer === 'public') ? moderatorScript(s) : null,
    outcome:
      s.phase === 'over' && s.winner
        ? {
            winner: s.winner,
            roles: Object.keys(s.assign).map((id) => {
              const r = roleOf(s, id);
              return {
                id,
                roleName: r.nameFa,
                emoji: r.emoji,
                team: r.team,
                initial: roleById(s, s.initialAssign[id]!).nameFa,
              };
            }),
            log: s.log,
          }
        : null,
  };
}

export function moderatorScript(s: MafiaState): NonNullable<MafiaView['script']> {
  const steps: { roleName: string; emoji: string; action: string; players: PlayerId[]; prio: number }[] = [];
  for (const role of s.roles) {
    const holders = Object.keys(s.assign).filter((p) => s.assign[p] === role.id);
    if (!holders.length) continue;
    role.night.forEach((ab) => {
      const key = ab.shared ? `${role.team}:${ab.action}` : `${role.id}:${ab.action}`;
      const existing = steps.find((x) => x.action === key);
      if (existing) existing.players.push(...holders.filter((h) => !existing.players.includes(h)));
      else
        steps.push({
          roleName: ab.shared ? role.team : role.nameFa,
          emoji: role.emoji,
          action: key,
          players: holders,
          prio: priorityOf(s, role, ab),
        });
    });
  }
  steps.sort((a, b) => a.prio - b.prio);
  return {
    order: steps.map(({ prio: _p, ...x }) => ({ ...x, action: x.action.split(':')[1]! })),
    roles: Object.keys(s.assign).map((id) => ({
      id,
      roleName: roleOf(s, id).nameFa,
      emoji: roleOf(s, id).emoji,
      team: roleOf(s, id).team,
    })),
  };
}

export function resultMafia(s: MafiaState): GameResult | null {
  if (s.phase !== 'over' || !s.winner) return null;
  const w = s.winner;
  const seats = Object.keys(s.assign);
  const winners = w.solo
    ? [w.solo]
    : seats.filter((p) => {
        const r = roleOf(s, p);
        if (r.team === w.team) return true;
        return r.team === 'neutral' && r.winCondition === 'survive' && s.alive.includes(p);
      });
  const scores: Record<PlayerId, number> = {};
  for (const p of winners) scores[p] = w.team === 'mafia' ? 3 : w.solo ? 4 : 2;
  if (s.moderator) scores[s.moderator] = 1;
  return {
    winners,
    title: {
      k: w.solo ? 'mafia.result.solo' : `mafia.result.${w.team}`,
      p: { name: w.solo ? name(s, w.solo) : '' },
    },
    lines: [{ k: w.reason }, ...s.log.slice(-4)],
    scores,
    reveal: seats.map((p) => ({ playerId: p, label: `${roleOf(s, p).emoji} ${roleOf(s, p).nameFa}` })),
    highlights: w.team === 'mafia' ? winners.map((p) => ({ key: 'mafia-win', playerId: p })) : [],
  };
}

export function pendingMafia(s: MafiaState): PlayerId[] {
  if (s.phase === 'reveal') return Object.keys(s.assign).filter((p) => !s.acked.includes(p));
  if (s.phase === 'night') return s.alive.filter((p) => !s.choices[p]);
  if ((s.phase === 'vote' || s.phase === 'final') && s.cfg.voteMode === 'secret')
    return s.alive.filter((p) => !s.votes[p]);
  if (s.phase === 'revenge' && s.revengeBy) return [s.revengeBy];
  return [];
}

export { SKIP };
