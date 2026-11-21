import type { ComponentType } from 'react';
import type { z } from 'zod';
import type { Rng } from './rng';

export type PlayerId = string;
export type FamilyId = 'hidden-word' | 'social-deduction' | 'word-guess' | 'team-board' | 'party';
export type PlayMode = 'online' | 'local';

/** Actor id used by the host runner for timer expiry and other system events. */
export const SYSTEM: PlayerId = '$system';

export interface Player {
  id: PlayerId;
  name: string;
}

/** A translatable message: i18n key + params. Reducers never emit raw UI text. */
export interface Msg {
  k: string;
  p?: Record<string, string | number>;
}

export interface Ctx {
  /** host clock, ms */
  now: number;
  rng: Rng;
  hostId: PlayerId;
}

export interface SetupOptions {
  now: number;
  hostId: PlayerId;
  /** pass & play (one shared phone) */
  local: boolean;
}

export type SystemAction = { type: '$timeout' };

export interface Highlight {
  /** stat key, e.g. 'spy-win' → «بهترین جاسوس» */
  key: string;
  playerId: PlayerId;
}

export interface GameResult {
  winners: PlayerId[];
  title: Msg;
  lines?: Msg[];
  /** score deltas for the session scoreboard */
  scores: Record<PlayerId, number>;
  /** public reveal after the round (roles, words, ...) */
  reveal?: { playerId: PlayerId; label: string }[];
  /** extra free text shown in results (e.g. the secret word) */
  secret?: string;
  highlights?: Highlight[];
}

export interface GameMeta {
  id: string;
  family: FamilyId;
  emoji: string;
  minPlayers: number;
  maxPlayers: number;
  supportsPassAndPlay: boolean;
  supportsOnline: boolean;
  supportsCustomRoles: boolean;
  /** roadmap phase that introduced it */
  phase: number;
}

export interface SetupProps<C> {
  config: C;
  onChange: (config: C) => void;
  playerCount: number;
  mode: PlayMode;
}

export interface PlayProps<V, A = unknown> {
  view: V;
  dispatch: (action: A) => void;
  /** viewer; null = shared/public screen in pass & play */
  me: PlayerId | null;
  /** may perform host/moderator actions on this screen */
  isHost: boolean;
  players: Player[];
  mode: PlayMode;
  /** host-synchronised clock */
  now: () => number;
}

export interface GameModule<Config = unknown, State = unknown, Action = unknown, View = unknown> {
  id: string;
  family: FamilyId;
  meta: GameMeta;
  configSchema: z.ZodType<Config>;
  /** validates actions coming from the network */
  actionSchema: z.ZodType<Action>;
  defaultConfig: Config;
  setup(players: Player[], config: Config, rng: Rng, opts: SetupOptions): State;
  /** pure: must not mutate `state` */
  reduce(state: State, action: Action | SystemAction, actor: PlayerId, ctx: Ctx): State;
  /** hides secrets: the only thing that ever leaves the host */
  viewFor(state: State, viewer: PlayerId | 'public'): View;
  result(state: State): GameResult | null;
  /** players that need the phone privately right now (pass & play hand-off, "waiting for…") */
  pending?(state: State): PlayerId[];
  /** absolute host time when the runner should fire `$timeout` */
  deadline?(state: State): number | null;
  /** returns an i18n key when the config/player count is not playable */
  validate?(config: Config, playerCount: number): Msg | null;
  screens: {
    Setup?: ComponentType<SetupProps<Config>>;
    Play: ComponentType<PlayProps<View, Action>>;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameModule = GameModule<any, any, any, any>;

/** Thrown by reducers for rejected actions; the runner turns it into an error message. */
export class GameError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
