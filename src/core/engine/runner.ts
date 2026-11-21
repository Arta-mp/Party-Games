import { createRng } from './rng';
import { GameError, SYSTEM, type AnyGameModule, type GameResult, type Player, type PlayerId } from './types';

export interface RunnerSnapshot {
  gameId: string;
  config: unknown;
  state: unknown;
  seed: number;
  step: number;
  players: Player[];
  hostId: PlayerId;
  local: boolean;
}

export type DispatchResult = { ok: true; changed: boolean } | { ok: false; error: string };

/**
 * Host-side game runner. Owns the authoritative state and is the only place reducers run.
 * Every reduce gets a fresh RNG derived from (seed, step) so a game is reproducible from its action log.
 */
export class GameRunner {
  private constructor(
    public readonly module: AnyGameModule,
    public state: unknown,
    public readonly config: unknown,
    public readonly seed: number,
    public step: number,
    public readonly players: Player[],
    public readonly hostId: PlayerId,
    public readonly local: boolean,
  ) {}

  static create(
    module: AnyGameModule,
    players: Player[],
    config: unknown,
    opts: { seed: number; now: number; hostId: PlayerId; local: boolean },
  ): GameRunner {
    const parsed = module.configSchema.parse(config);
    const rng = createRng(`${opts.seed}:setup`);
    const state = module.setup(players, parsed, rng, {
      now: opts.now,
      hostId: opts.hostId,
      local: opts.local,
    });
    return new GameRunner(module, state, parsed, opts.seed, 0, players, opts.hostId, opts.local);
  }

  static restore(module: AnyGameModule, snap: RunnerSnapshot): GameRunner {
    return new GameRunner(
      module,
      snap.state,
      snap.config,
      snap.seed,
      snap.step,
      snap.players,
      snap.hostId,
      snap.local,
    );
  }

  snapshot(): RunnerSnapshot {
    return {
      gameId: this.module.id,
      config: this.config,
      state: this.state,
      seed: this.seed,
      step: this.step,
      players: this.players,
      hostId: this.hostId,
      local: this.local,
    };
  }

  dispatch(action: unknown, actor: PlayerId, now: number): DispatchResult {
    let parsed: unknown = action;
    if (actor !== SYSTEM) {
      const res = this.module.actionSchema.safeParse(action);
      if (!res.success) return { ok: false, error: 'bad-action' };
      parsed = res.data;
      if (!this.players.some((p) => p.id === actor)) return { ok: false, error: 'not-a-player' };
    }
    const rng = createRng(`${this.seed}:${this.step}`);
    try {
      const next = this.module.reduce(this.state, parsed, actor, { now, rng, hostId: this.hostId });
      this.step++;
      const changed = next !== this.state;
      this.state = next;
      return { ok: true, changed };
    } catch (err) {
      if (err instanceof GameError) return { ok: false, error: err.code };
      throw err;
    }
  }

  /** Fires `$timeout` if the module's deadline passed. Returns true when state changed. */
  tick(now: number): boolean {
    const d = this.deadline();
    if (d == null || d > now) return false;
    const r = this.dispatch({ type: '$timeout' }, SYSTEM, now);
    return r.ok && r.changed;
  }

  viewFor(viewer: PlayerId | 'public'): unknown {
    return this.module.viewFor(this.state, viewer);
  }

  result(): GameResult | null {
    return this.module.result(this.state);
  }

  pending(): PlayerId[] {
    return this.module.pending?.(this.state) ?? [];
  }

  deadline(): number | null {
    return this.module.deadline?.(this.state) ?? null;
  }
}
