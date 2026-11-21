import { expect } from 'vitest';
import { GameRunner } from '@/core/engine/runner';
import type { AnyGameModule, Player, PlayerId } from '@/core/engine/types';

export function makePlayers(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `بازیکن ${i + 1}` }));
}

export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
  }
  return obj;
}

/** Test driver around GameRunner: frozen states prove reducers are pure. */
export class Driver {
  now = 1_000_000;
  runner: GameRunner;
  constructor(
    public module: AnyGameModule,
    public players: Player[],
    config?: unknown,
    opts: { seed?: number; local?: boolean } = {},
  ) {
    this.runner = GameRunner.create(module, players, config ?? module.defaultConfig, {
      seed: opts.seed ?? 42,
      now: this.now,
      hostId: players[0]!.id,
      local: opts.local ?? false,
    });
    deepFreeze(this.runner.state);
  }
  get state() {
    return this.runner.state as never;
  }
  act(actor: PlayerId, action: unknown) {
    deepFreeze(this.runner.state);
    const r = this.runner.dispatch(action, actor, this.now);
    if (!r.ok) throw new Error(`action rejected: ${r.error} ${JSON.stringify(action)}`);
    return r;
  }
  /** dispatch expecting no state change */
  noop(actor: PlayerId, action: unknown) {
    const before = this.runner.state;
    const r = this.runner.dispatch(action, actor, this.now);
    expect(r.ok && this.runner.state === before).toBe(true);
  }
  advance(ms: number) {
    this.now += ms;
    return this.runner.tick(this.now);
  }
  view(viewer: PlayerId | 'public') {
    return this.runner.viewFor(viewer) as never;
  }
  pending() {
    return this.runner.pending();
  }
  result() {
    return this.runner.result();
  }
  ids() {
    return this.players.map((p) => p.id);
  }
}

/** asserts that the JSON of `view` doesn't contain any of `secrets` */
export function expectNoLeak(view: unknown, secrets: string[], label = '') {
  const json = JSON.stringify(view);
  for (const s of secrets) expect(json.includes(s), `${label} leaked "${s}"`).toBe(false);
}
