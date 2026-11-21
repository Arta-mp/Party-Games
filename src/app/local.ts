import { create } from 'zustand';
import { GameRunner, type RunnerSnapshot } from '@/core/engine/runner';
import { randomSeed } from '@/core/engine/rng';
import type { AnyGameModule, GameResult, Player, PlayerId } from '@/core/engine/types';
import { applyResult, type LobbyState } from '@/core/lobby/lobby';
import { loadGame } from '@/games/registry';
import { readJSON, writeJSON } from '@/lib/storage';

/**
 * Pass & Play: one phone, no network. Runs the very same GameRunner/reducers as online play;
 * the UI decides whose private view to show via the module's `pending()` and hand-off screens.
 */
interface LocalStore {
  names: string[];
  gameId: string | null;
  config: unknown;
  module: AnyGameModule | null;
  runner: GameRunner | null;
  rev: number;
  /** session data shaped like the online lobby so results/scoreboard UI is shared */
  session: Pick<LobbyState, 'scores' | 'stats' | 'round' | 'result'> & { players: Player[] };
  restored: boolean;
  setNames(names: string[]): void;
  select(gameId: string, config: unknown): Promise<void>;
  start(): Promise<string | null>;
  act(actor: PlayerId, action: unknown): string | null;
  tick(now: number): void;
  next(): Promise<string | null>;
  toSetup(): void;
  restore(): Promise<void>;
}

const KEY = 'pg:local';
const HOST: PlayerId = 'p1';

interface Saved {
  names: string[];
  gameId: string | null;
  config: unknown;
  runner: RunnerSnapshot | null;
  session: LocalStore['session'];
}

const emptySession = (): LocalStore['session'] => ({ scores: {}, stats: {}, round: 0, result: null, players: [] });
const playersOf = (names: string[]): Player[] => names.map((name, i) => ({ id: `p${i + 1}`, name }));

export const useLocal = create<LocalStore>((set, get) => {
  const save = () => {
    const s = get();
    writeJSON(KEY, {
      names: s.names,
      gameId: s.gameId,
      config: s.config,
      runner: s.runner?.snapshot() ?? null,
      session: s.session,
    } satisfies Saved);
  };
  const afterChange = () => {
    const { runner, session } = get();
    const r: GameResult | null = runner?.result() ?? null;
    let next = session;
    if (r && !session.result) {
      const l = applyResult({ ...session, players: [] } as unknown as LobbyState, r);
      next = { ...session, scores: l.scores, stats: l.stats, result: r };
      for (const p of session.players) {
        next.stats[p.id] ??= {};
        next.stats[p.id]!['played'] = (next.stats[p.id]!['played'] ?? 0) + 1;
      }
    }
    set((s) => ({ rev: s.rev + 1, session: next }));
    save();
  };
  return {
    names: [],
    gameId: null,
    config: null,
    module: null,
    runner: null,
    rev: 0,
    session: emptySession(),
    restored: false,
    setNames(names) {
      const same = names.join('|') === get().names.join('|');
      set({ names, ...(same ? {} : { session: { ...emptySession(), players: playersOf(names) } }) });
      save();
    },
    async select(gameId, config) {
      const module = await loadGame(gameId);
      set({ gameId, config: module.configSchema.parse(config ?? module.defaultConfig), module });
      save();
    },
    async start() {
      const { gameId, config, names } = get();
      if (!gameId) return 'err.noGame';
      const module = await loadGame(gameId);
      const players = playersOf(names);
      const invalid = module.validate?.(config as never, players.length);
      if (invalid) return invalid.k;
      const runner = GameRunner.create(module, players, config, { seed: randomSeed(), now: Date.now(), hostId: HOST, local: true });
      set((s) => ({ module, runner, session: { ...s.session, players, round: s.session.round + 1, result: null } }));
      afterChange();
      return null;
    },
    act(actor, action) {
      const runner = get().runner;
      if (!runner) return 'no-game';
      const r = runner.dispatch(action, actor, Date.now());
      if (!r.ok) return r.error;
      if (r.changed) afterChange();
      return null;
    },
    tick(now) {
      const runner = get().runner;
      if (runner && !runner.result() && runner.tick(now)) afterChange();
    },
    next: () => get().start(),
    toSetup() {
      set((s) => ({ runner: null, session: { ...s.session, result: null } }));
      save();
    },
    async restore() {
      if (get().restored) return;
      const saved = readJSON<Saved | null>(KEY, null);
      if (!saved) return set({ restored: true });
      let module: AnyGameModule | null = null;
      let runner: GameRunner | null = null;
      try {
        if (saved.gameId) module = await loadGame(saved.gameId);
        if (saved.runner && module && saved.runner.gameId === module.id) runner = GameRunner.restore(module, saved.runner);
      } catch {
        runner = null;
      }
      set({
        names: saved.names ?? [],
        gameId: saved.gameId,
        config: saved.config,
        module,
        runner,
        session: { ...emptySession(), ...saved.session },
        restored: true,
      });
    },
  };
});
