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
export type Phase = 'reveal' | 'night' | 'dawn' | 'day' | 'vote' | 'revenge' | 'moderating' | 'over';

export const mafiaConfig = z.object({
  /** null = pick a sensible default for the player count */
  composition: z
    .array(z.object({ role: abilityRoleSchema, n: z.number().int().min(0).max(12) }))
    .nullable()
    .default(null),
  daySeconds: z.number().int().min(0).max(1200).default(240),
  revealOnDeath: z.boolean().default(true),
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
  }),
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
  } | null;
  silenced: PlayerId[];
  endsAt: number | null;
  cfg: MafiaConfig;
  votes: Record<PlayerId, PlayerId>;
  lastLynch: { id: PlayerId | null; role: string | null; tally: Record<string, number> } | null;
  revengeBy: PlayerId | null;
  afterRevenge: 'night' | 'day' | null;
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
    .filter(({ ability, usesLeft }) => ability.fromNight <= s.night && (usesLeft == null || usesLeft > 0));
}

export function validTarget(s: MafiaState, actor: PlayerId, ab: NightAbility, target: PlayerId): boolean {
  if (!s.alive.includes(target)) return false;
  switch (ab.target) {
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
  prio: number;
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
    const act: Act = { actor, role, index: ch.ability, ab, target: ch.target, prio: priorityOf(s, role, ab) };
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
        const mafiaRole = s.roles.find((r) => r.team === a.role.team && r.id !== a.role.id) ?? a.role;
        if (targetRole.team !== a.role.team) {
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
        const guilty = targetRole.passive.includes('appearsInnocent')
          ? false
          : targetRole.passive.includes('appearsGuilty')
            ? true
            : targetRole.team === 'mafia';
        note(s, a.actor, {
          k: guilty ? 'mafia.note.guilty' : 'mafia.note.innocent',
          p: { name: name(s, a.target) },
        });
        break;
      }
      case 'reveal':
        revealed.push({ id: a.target, role: targetRole.nameFa });
        break;
    }
  }
  const victims = [...killed.keys()].filter((v) => s.alive.includes(v));
  s.alive = s.alive.filter((p) => !victims.includes(p));
  s.dawn = {
    killed: victims.map((id) => ({ id, role: s.cfg.revealOnDeath ? roleOf(s, id).nameFa : null })),
    saved,
    revealed,
    silenced: [...s.silenced],
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
  const rest = s.alive.length - mafia;
  if (mafia === 0) return { team: 'citizens', solo: null, reason: 'mafia.reason.allMafiaGone' };
  if (mafia >= rest) return { team: 'mafia', solo: null, reason: 'mafia.reason.outnumber' };
  return null;
}

function finish(s: MafiaState, w: NonNullable<MafiaState['winner']>) {
  s.winner = w;
  s.phase = 'over';
  s.endsAt = null;
}

function onDeaths(s: MafiaState, dead: PlayerId[], next: 'night' | 'day'): boolean {
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
  const t: Record<string, number> = {};
  for (const v of Object.values(s.votes)) t[v] = (t[v] ?? 0) + 1;
  const max = Math.max(...Object.values(t));
  const top = Object.keys(t).filter((k) => t[k] === max);
  const target = top.length === 1 && top[0] !== SKIP ? top[0]! : null;
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
      }
      s.choices[actor] = { ability: action.ability, target: action.ability >= 0 ? action.target : null };
      if (s.alive.every((p) => s.choices[p])) {
        const dead = resolveNight(s);
        s.phase = 'dawn';
        const w = s.kind === 'onenight' ? null : checkWin(s);
        if (w) finish(s, w);
        else if (s.kind !== 'onenight' && onDeaths(s, dead, 'day')) {
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
      if (s.phase !== 'day') return state;
      s.phase = 'vote';
      s.endsAt = null;
      return s;
    }
    case 'startVote': {
      if (s.phase !== 'day' || !hostOk(s, actor)) return state;
      s.phase = 'vote';
      s.endsAt = null;
      return s;
    }
    case 'vote': {
      if (s.phase !== 'vote' || s.cfg.voteMode !== 'secret' || !s.alive.includes(actor) || s.votes[actor])
        return state;
      if (action.target !== SKIP && (!s.alive.includes(action.target) || action.target === actor))
        return state;
      s.votes[actor] = action.target;
      if (s.alive.every((p) => s.votes[p])) return tallyVotes(s, now);
      return s;
    }
    case 'hostLynch': {
      if (s.phase !== 'vote' || !hostOk(s, actor)) return state;
      if (action.target && !s.alive.includes(action.target)) return state;
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
      if (s.afterRevenge === 'day') s.phase = 'dawn';
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
      usesLeft: number | null;
    }[];
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
              usesLeft: a.usesLeft,
            })),
            choice: s.choices[viewer as PlayerId] ?? null,
            teamPicks:
              s.phase === 'night'
                ? mates
                    .filter((m) => s.alive.includes(m))
                    .map((m) => {
                      const c = s.choices[m];
                      const ab = c && c.ability >= 0 ? roleOf(s, m).night[c.ability] : null;
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
  if (s.phase === 'vote' && s.cfg.voteMode === 'secret') return s.alive.filter((p) => !s.votes[p]);
  if (s.phase === 'revenge' && s.revengeBy) return [s.revengeBy];
  return [];
}

export { SKIP };
