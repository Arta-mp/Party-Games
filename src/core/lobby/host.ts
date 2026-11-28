import { GameRunner, type RunnerSnapshot } from '@/core/engine/runner';
import { randomSeed } from '@/core/engine/rng';
import type { AnyGameModule, Player, PlayerId } from '@/core/engine/types';
import {
  clientMsgSchema,
  type ClientMsg,
  type Hello,
  type HostMsg,
  type LobbyAction,
} from '@/core/net/protocol';
import type { Transport, Unsubscribe } from '@/core/net/transport';
import {
  addPlayer,
  applyResult,
  canStart,
  createLobby,
  removePlayer,
  setConnected,
  sweep,
  type LobbyState,
} from './lobby';

export interface HostSnapshot {
  v: 1;
  lobby: LobbyState;
  runner: RunnerSnapshot | null;
  devices: Record<string, PlayerId>;
  banned: string[];
  savedAt: number;
}

export interface HostDeps {
  transport: Transport;
  now: () => number;
  loadGame: (id: string) => Promise<AnyGameModule>;
  persist?: (snap: HostSnapshot) => void;
  seed?: () => number;
  /** called when this host handed over or was superseded and should become a client */
  onStepDown?: (reason: 'transfer' | 'superseded') => void;
  /** tick period for timers & sweeping (ms) */
  tickMs?: number;
}

type LocalSink = (msg: HostMsg) => void;
const LOCAL = 'local:';

/**
 * §4.3 host-authoritative server running on the lobby creator's phone.
 * Clients only send actions; the host validates (Zod), reduces, and sends every player
 * *only their own* view (toPeer). broadcast is used solely for the public lobby state.
 */
export class HostSession {
  lobby: LobbyState;
  runner: GameRunner | null = null;
  private devices = new Map<string, PlayerId>();
  private peers = new Map<string, PlayerId>(); // peer id → player
  private banned = new Set<string>();
  private locals = new Map<string, LocalSink>();
  private rev = 0;
  private subs: Unsubscribe[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;
  private stopped = false;
  private starting: Promise<void> | null = null;
  /** set while handing the room over before leaving; resolves once the new host is up */
  private handedOver: (() => void) | null = null;

  private constructor(
    private deps: HostDeps,
    lobby: LobbyState,
  ) {
    this.lobby = lobby;
  }

  static create(code: string, host: Hello, deps: HostDeps): HostSession {
    const id = 'p1';
    const s = new HostSession(deps, createLobby(code, { id, name: host.name }, deps.now()));
    s.devices.set(host.deviceId, id);
    s.nextId = 2;
    return s;
  }

  /** Resume after a page refresh (same epoch) or take over a transferred snapshot (higher epoch). */
  static async restore(
    snap: HostSnapshot,
    deps: HostDeps,
    opts: { asHost?: PlayerId; epoch?: number } = {},
  ): Promise<HostSession> {
    const lobby: LobbyState = {
      ...snap.lobby,
      hostId: opts.asHost ?? snap.lobby.hostId,
      epoch: opts.epoch ?? snap.lobby.epoch,
      players: snap.lobby.players.map((p) => ({
        ...p,
        connected: p.id === (opts.asHost ?? snap.lobby.hostId),
      })),
    };
    const s = new HostSession(deps, lobby);
    for (const [d, p] of Object.entries(snap.devices)) s.devices.set(d, p);
    for (const b of snap.banned) s.banned.add(b);
    s.nextId = 1 + Math.max(0, ...lobby.players.map((p) => Number(p.id.replace(/\D/g, '')) || 0));
    if (snap.runner) {
      const mod = await deps.loadGame(snap.runner.gameId);
      s.runner = GameRunner.restore(mod, { ...snap.runner, hostId: lobby.hostId });
    }
    return s;
  }

  /** New host after an election: only the public lobby survives; the running game is stopped. */
  static fromLobby(prev: LobbyState, me: { id: PlayerId; deviceId: string }, deps: HostDeps): HostSession {
    const lobby: LobbyState = {
      ...prev,
      epoch: prev.epoch + 1,
      hostId: me.id,
      status: 'lobby',
      result: null,
      notice: prev.status === 'playing' ? 'hostLeftGame' : 'hostLeft',
      players: prev.players.map((p) => ({
        ...p,
        connected: p.id === me.id,
        ready: p.id === me.id,
        lastSeen: deps.now(),
      })),
    };
    const s = new HostSession(deps, lobby);
    s.devices.set(me.deviceId, me.id);
    s.nextId = 1 + Math.max(0, ...lobby.players.map((p) => Number(p.id.replace(/\D/g, '')) || 0));
    return s;
  }

  start(): Promise<void> {
    this.starting ??= (async () => {
      const t = this.deps.transport;
      this.subs.push(
        t.on('message', (raw, from) => this.handle(from, raw)),
        t.on('peer-leave', (peer) => this.onPeerLeave(peer)),
      );
      await t.host(this.lobby.code, { epoch: this.lobby.epoch });
      this.timer = setInterval(() => this.tick(), this.deps.tickMs ?? 500);
      this.persist();
    })();
    return this.starting;
  }

  stop() {
    this.stopped = true;
    for (const u of this.subs.splice(0)) u();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The host's own UI talks to the session through this loopback (same code path as remote players). */
  loopback(onMsg: LocalSink): { send: (msg: ClientMsg) => void; close: () => void } {
    const key = `${LOCAL}${Math.random().toString(36).slice(2)}`;
    this.locals.set(key, onMsg);
    return {
      send: (msg) => queueMicrotask(() => this.handle(key, msg)),
      close: () => {
        this.locals.delete(key);
        this.onPeerLeave(key);
      },
    };
  }

  /** ClientLink for the host's own ClientSession (loopback, no network). */
  localLink(hello: Hello): import('./client').ClientLink {
    const handlers = new Set<(m: unknown) => void>();
    const lb = this.loopback((m) => handlers.forEach((h) => h(m)));
    lb.send({ t: 'hello', ...hello });
    return {
      send: lb.send,
      onMessage: (cb) => (handlers.add(cb), () => void handlers.delete(cb)),
      onHost: () => () => undefined,
      close: lb.close,
    };
  }

  // ------------------------------------------------------------------ inbound

  handle(peer: string, raw: unknown) {
    if (this.stopped) return;
    if (
      raw &&
      typeof raw === 'object' &&
      (raw as HostMsg).t === 'error' &&
      (raw as { code?: string }).code === 'superseded'
    ) {
      this.stop();
      if (this.handedOver)
        this.handedOver(); // we are leaving: the successor is up, nothing else to do
      else this.deps.onStepDown?.('superseded');
      return;
    }
    const parsed = clientMsgSchema.safeParse(raw);
    if (!parsed.success) return this.send(peer, { t: 'error', code: 'bad-message' });
    const msg = parsed.data;
    if (msg.t === 'ping') return this.send(peer, { t: 'pong', now: this.deps.now() });
    if (msg.t === 'hello') return this.onHello(peer, msg);
    const player = this.peers.get(peer);
    if (!player) return this.send(peer, { t: 'error', code: 'not-joined' });
    const env = msg.action;
    if (env.scope === 'lobby') return void this.onLobbyAction(player, env.a);
    if (!this.runner || this.lobby.status !== 'playing')
      return this.send(peer, { t: 'error', code: 'no-game' });
    const r = this.runner.dispatch(env.a, player, this.deps.now());
    if (!r.ok) return this.send(peer, { t: 'error', code: r.error });
    if (r.changed) this.afterGameChange();
  }

  private onHello(peer: string, msg: Extract<ClientMsg, { t: 'hello' }>) {
    const now = this.deps.now();
    if (this.banned.has(msg.deviceId)) return this.send(peer, { t: 'error', code: 'kicked' });
    let id = this.devices.get(msg.deviceId);
    if (!id && msg.playerId) {
      // seat reclaim after an election: allowed if that seat exists, is offline and unclaimed
      const seat = this.lobby.players.find((p) => p.id === msg.playerId);
      const claimed = [...this.devices.values()].includes(msg.playerId);
      if (seat && !seat.connected && !claimed) id = seat.id;
    }
    if (!id) {
      if (this.lobby.locked) return this.send(peer, { t: 'error', code: 'locked' });
      if (this.lobby.status === 'playing') return this.send(peer, { t: 'error', code: 'in-game' });
      if (this.lobby.players.length >= 24) return this.send(peer, { t: 'error', code: 'full' });
      id = `p${this.nextId++}`;
      this.lobby = addPlayer(this.lobby, id, msg.name, now);
    } else if (!this.lobby.players.some((p) => p.id === id)) {
      // was swept from the lobby after the grace period: join again as a new seat
      if (this.lobby.locked) return this.send(peer, { t: 'error', code: 'locked' });
      if (this.lobby.status === 'playing') return this.send(peer, { t: 'error', code: 'in-game' });
      this.lobby = addPlayer(this.lobby, id, msg.name, now);
    }
    this.devices.set(msg.deviceId, id);
    for (const [p, pid] of this.peers) if (pid === id && p !== peer) this.peers.delete(p);
    this.peers.set(peer, id);
    this.lobby = setConnected(this.lobby, id, true, now);
    this.send(peer, { t: 'welcome', playerId: id, now });
    this.broadcastLobby();
    if (this.runner && this.lobby.status === 'playing') this.sendView(id);
    this.persist();
  }

  private onPeerLeave(peer: string) {
    const id = this.peers.get(peer);
    if (!id) return;
    this.peers.delete(peer);
    if ([...this.peers.values()].includes(id)) return;
    this.lobby = setConnected(this.lobby, id, false, this.deps.now());
    this.broadcastLobby();
    this.persist();
  }

  private isHost(id: PlayerId) {
    return id === this.lobby.hostId;
  }

  async onLobbyAction(actor: PlayerId, a: LobbyAction): Promise<void> {
    const l = this.lobby;
    switch (a.type) {
      case 'ready':
        this.lobby = { ...l, players: l.players.map((p) => (p.id === actor ? { ...p, ready: a.ready } : p)) };
        break;
      case 'rename': {
        const name = a.name.trim();
        if (name.length < 2) return;
        const taken = l.players.filter((p) => p.id !== actor).map((p) => p.name);
        if (taken.includes(name)) return this.sendTo(actor, { t: 'error', code: 'name-taken' });
        this.lobby = { ...l, players: l.players.map((p) => (p.id === actor ? { ...p, name } : p)) };
        break;
      }
      default:
        if (!this.isHost(actor)) return this.sendTo(actor, { t: 'error', code: 'not-host' });
        return this.onHostAction(a);
    }
    this.broadcastLobby();
    this.persist();
  }

  private async onHostAction(a: LobbyAction) {
    const l = this.lobby;
    const now = this.deps.now();
    switch (a.type) {
      case 'kick': {
        if (a.id === l.hostId) return;
        for (const [d, p] of this.devices) if (p === a.id) this.banned.add(d);
        for (const [peer, p] of this.peers) {
          if (p === a.id) {
            this.send(peer, { t: 'error', code: 'kicked' });
            this.peers.delete(peer);
          }
        }
        this.lobby = removePlayer(l, a.id);
        break;
      }
      case 'lock':
        this.lobby = { ...l, locked: a.locked };
        break;
      case 'select': {
        try {
          const mod = await this.deps.loadGame(a.gameId);
          const config = mod.configSchema.parse(a.config ?? mod.defaultConfig);
          this.lobby = { ...this.lobby, game: { id: a.gameId, config } };
        } catch {
          return this.sendTo(l.hostId, { t: 'error', code: 'bad-config' });
        }
        break;
      }
      case 'start':
      case 'next': {
        if (canStart(l) !== 'ok' && a.type === 'start')
          return this.sendTo(l.hostId, { t: 'error', code: canStart(l) });
        if (!l.game) return;
        const mod = await this.deps.loadGame(l.game.id);
        const players: Player[] = this.lobby.players
          .filter((p) => p.connected)
          .map((p) => ({ id: p.id, name: p.name }));
        const invalid = mod.validate?.(l.game.config as never, players.length);
        if (invalid) return this.sendTo(l.hostId, { t: 'error', code: invalid.k });
        this.runner = GameRunner.create(mod, players, l.game.config, {
          seed: this.deps.seed?.() ?? randomSeed(),
          now,
          hostId: l.hostId,
          local: false,
        });
        this.rev++;
        this.lobby = {
          ...this.lobby,
          status: 'playing',
          round: this.lobby.round + 1,
          result: null,
          notice: null,
        };
        this.broadcastLobby();
        this.pushViews();
        this.persist();
        return;
      }
      case 'toLobby':
        this.runner = null;
        this.lobby = {
          ...l,
          status: 'lobby',
          result: null,
          players: l.players.map((p) => ({ ...p, ready: p.id === l.hostId })),
        };
        break;
      case 'transfer': {
        const target = l.players.find((p) => p.id === a.id && p.connected);
        const peer = [...this.peers].find(([, p]) => p === a.id)?.[0];
        if (!target || !peer || peer.startsWith(LOCAL)) return;
        this.send(peer, { t: 'snapshot', data: this.snapshotFor(a.id, false) });
        this.stop();
        this.deps.onStepDown?.('transfer');
        return;
      }
    }
    this.broadcastLobby();
    this.persist();
  }

  // ------------------------------------------------------------------ outbound

  private tick() {
    if (this.stopped) return;
    const now = this.deps.now();
    let changed = false;
    if (this.runner && this.lobby.status === 'playing' && this.runner.tick(now)) {
      this.afterGameChange();
      changed = true;
    }
    const swept = sweep(this.lobby, now);
    if (swept !== this.lobby) {
      this.lobby = swept;
      this.broadcastLobby();
      changed = true;
    }
    if (changed) this.persist();
  }

  private afterGameChange() {
    this.rev++;
    const r = this.runner?.result();
    if (r && !this.lobby.result) {
      this.lobby = applyResult(this.lobby, r);
      this.broadcastLobby();
    }
    this.pushViews();
    this.persist();
  }

  private peerOf(id: PlayerId): string[] {
    return [...this.peers].filter(([, p]) => p === id).map(([peer]) => peer);
  }

  private sendView(id: PlayerId) {
    if (!this.runner) return;
    const msg: HostMsg = {
      t: 'view',
      gameId: this.runner.module.id,
      view: this.runner.viewFor(id),
      rev: this.rev,
      now: this.deps.now(),
    };
    for (const peer of this.peerOf(id)) this.send(peer, msg);
  }

  /** each player gets *their own* view — secrets are never broadcast */
  private pushViews() {
    if (!this.runner) return;
    for (const p of this.runner.players) this.sendView(p.id);
  }

  private sendTo(id: PlayerId, msg: HostMsg) {
    for (const peer of this.peerOf(id)) this.send(peer, msg);
  }

  private send(peer: string, msg: HostMsg) {
    if (peer.startsWith(LOCAL)) {
      const sink = this.locals.get(peer);
      if (sink) queueMicrotask(() => sink(structuredClone(msg)));
      return;
    }
    this.deps.transport.toPeer(peer, msg);
  }

  private broadcastLobby() {
    const msg: HostMsg = {
      t: 'lobby',
      lobby: this.lobby as unknown as Record<string, unknown>,
      now: this.deps.now(),
    };
    this.deps.transport.broadcast(msg);
    for (const key of this.locals.keys()) this.send(key, msg);
  }

  /**
   * Full snapshot for the next host (sent to that one phone only). The running game moves along with
   * its host-only powers; if the game can't continue without us it is stopped.
   */
  private snapshotFor(next: PlayerId, leaving: boolean): HostSnapshot {
    const snap = this.snapshot();
    const me = this.lobby.hostId;
    const runner = this.runner?.handOver(next, { now: this.deps.now(), leaving }) ?? null;
    const gameStopped = !!this.runner && this.lobby.status === 'playing' && !runner;
    let players = snap.lobby.players;
    if (leaving)
      players =
        this.lobby.status === 'playing' && !gameStopped
          ? players.map((p) => (p.id === me ? { ...p, connected: false, lastSeen: this.deps.now() } : p))
          : players.filter((p) => p.id !== me);
    snap.lobby = {
      ...snap.lobby,
      epoch: this.lobby.epoch + 1,
      hostId: next,
      players,
      ...(gameStopped
        ? {
            status: 'lobby' as const,
            result: null,
            players: players.map((p) => ({ ...p, ready: p.id === next })),
          }
        : {}),
      notice: !leaving
        ? this.lobby.notice
        : gameStopped
          ? 'hostLeftGame'
          : this.lobby.status === 'playing'
            ? 'hostHandedOver'
            : 'hostLeft',
    };
    snap.runner = gameStopped ? null : runner;
    if (leaving) snap.devices = Object.fromEntries(Object.entries(snap.devices).filter(([, p]) => p !== me));
    return snap;
  }

  /** the next host if we leave: the longest-connected player who is reachable over the network */
  successor(): PlayerId | null {
    const reachable = new Set([...this.peers].filter(([peer]) => !peer.startsWith(LOCAL)).map(([, p]) => p));
    return (
      this.lobby.players
        .filter((p) => p.id !== this.lobby.hostId && p.connected && reachable.has(p.id))
        .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))[0]?.id ?? null
    );
  }

  /**
   * The host is leaving for good: hand the room (and the running game) to the next player right away
   * instead of making everyone wait for an election. Resolves true once the successor has taken over
   * (or after `timeoutMs`), false if there was nobody to hand over to.
   */
  handOver(timeoutMs = 5000): Promise<boolean> {
    const next = this.successor();
    if (!next || this.stopped) return Promise.resolve(false);
    const snap = this.snapshotFor(next, true);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.handedOver = null;
        this.stop();
        resolve(true);
      };
      const timer = setTimeout(done, timeoutMs);
      this.handedOver = done;
      for (const peer of this.peerOf(next)) this.send(peer, { t: 'snapshot', data: snap });
    });
  }

  snapshot(): HostSnapshot {
    return {
      v: 1,
      lobby: this.lobby,
      runner: this.runner?.snapshot() ?? null,
      devices: Object.fromEntries(this.devices),
      banned: [...this.banned],
      savedAt: this.deps.now(),
    };
  }

  private persist() {
    this.deps.persist?.(this.snapshot());
  }
}
