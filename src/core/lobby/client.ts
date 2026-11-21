import { hostMsgSchema, type ClientMsg, type Envelope, type Hello, type LobbyAction } from '@/core/net/protocol';
import { HOST_PEER, type Transport, type Unsubscribe } from '@/core/net/transport';
import { electHost, type LobbyState } from './lobby';
import type { HostSnapshot } from './host';

/** How a client reaches the host: over a Transport, or the host's own in-process loopback. */
export interface ClientLink {
  send(msg: ClientMsg): void;
  onMessage(cb: (msg: unknown) => void): Unsubscribe;
  onHost(cb: (present: boolean) => void): Unsubscribe;
  close(): void;
}

export function transportLink(t: Transport, code: string, hello: Hello): ClientLink {
  void t.join(code, hello);
  return {
    send: (m) => t.toHost(m),
    onMessage: (cb) => t.on('message', (m) => cb(m)),
    onHost: (cb) => {
      const a = t.on('peer-join', (p) => p === HOST_PEER && cb(true));
      const b = t.on('peer-leave', (p) => p === HOST_PEER && cb(false));
      return () => (a(), b());
    },
    close: () => t.leave(),
  };
}

export type ClientStatus = 'connecting' | 'online' | 'host-lost' | 'kicked' | 'locked' | 'in-game' | 'full';

export interface ClientState {
  status: ClientStatus;
  playerId: string | null;
  lobby: LobbyState | null;
  gameId: string | null;
  view: unknown;
  rev: number;
  /** host clock − local clock */
  offset: number;
  lastError: string | null;
  hostLostAt: number | null;
}

export type Promotion = { kind: 'snapshot'; data: HostSnapshot } | { kind: 'election'; lobby: LobbyState };

export const HOST_GRACE_MS = 15_000;

export class ClientSession {
  state: ClientState = {
    status: 'connecting',
    playerId: null,
    lobby: null,
    gameId: null,
    view: null,
    rev: -1,
    offset: 0,
    lastError: null,
    hostLostAt: null,
  };
  private seq = 0;
  private subs: Unsubscribe[] = [];
  private electionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private link: ClientLink,
    private opts: {
      hello: Hello;
      onChange: (s: ClientState) => void;
      onPromote?: (p: Promotion) => void;
      localNow?: () => number;
      graceMs?: number;
    },
  ) {
    this.subs.push(
      link.onMessage((m) => this.handle(m)),
      link.onHost((present) => (present ? this.hostUp() : this.hostDown())),
    );
  }

  private localNow() {
    return this.opts.localNow?.() ?? Date.now();
  }

  /** host-synchronised clock (used for endsAt timers) */
  now = () => this.localNow() + this.state.offset;

  private set(patch: Partial<ClientState>) {
    this.state = { ...this.state, ...patch };
    this.opts.onChange(this.state);
  }

  private handle(raw: unknown) {
    const parsed = hostMsgSchema.safeParse(raw);
    if (!parsed.success) return;
    const msg = parsed.data;
    const offset = 'now' in msg ? msg.now - this.localNow() : this.state.offset;
    switch (msg.t) {
      case 'welcome':
        this.opts.hello.playerId = msg.playerId;
        this.set({ playerId: msg.playerId, status: 'online', offset, hostLostAt: null, lastError: null });
        break;
      case 'lobby': {
        const lobby = msg.lobby as unknown as LobbyState;
        const patch: Partial<ClientState> = { lobby, offset };
        if (lobby.status === 'lobby') Object.assign(patch, { view: null, gameId: null });
        this.set(patch);
        break;
      }
      case 'view':
        if (msg.rev < this.state.rev && msg.gameId === this.state.gameId) return;
        this.set({ view: msg.view, gameId: msg.gameId, rev: msg.rev, offset });
        break;
      case 'error':
        if (msg.code === 'kicked' || msg.code === 'locked' || msg.code === 'in-game' || msg.code === 'full') this.set({ status: msg.code });
        else this.set({ lastError: msg.code });
        break;
      case 'snapshot':
        this.opts.onPromote?.({ kind: 'snapshot', data: msg.data as HostSnapshot });
        break;
      case 'pong':
        this.set({ offset });
        break;
    }
  }

  private hostUp() {
    this.stopElection();
    if (this.state.status === 'host-lost') this.set({ status: 'connecting', hostLostAt: null });
  }

  private hostDown() {
    if (this.state.status === 'kicked') return;
    this.set({ status: 'host-lost', hostLostAt: this.localNow() });
    this.stopElection();
    const grace = this.opts.graceMs ?? HOST_GRACE_MS;
    this.electionTimer = setInterval(() => this.checkElection(grace), Math.min(1000, grace / 4));
  }

  checkElection(grace = this.opts.graceMs ?? HOST_GRACE_MS) {
    const { lobby, playerId, hostLostAt, status } = this.state;
    if (status !== 'host-lost' || !lobby || !playerId || hostLostAt == null) return;
    const elected = electHost(lobby, this.localNow() - hostLostAt, grace);
    if (elected === playerId) {
      this.stopElection();
      this.opts.onPromote?.({ kind: 'election', lobby });
    }
  }

  private stopElection() {
    if (this.electionTimer) clearInterval(this.electionTimer);
    this.electionTimer = null;
  }

  send(env: Envelope) {
    this.link.send({ t: 'action', action: env, seq: ++this.seq });
  }

  lobbyAction(a: LobbyAction) {
    this.send({ scope: 'lobby', a });
  }

  gameAction(a: unknown) {
    this.send({ scope: 'game', a });
  }

  close() {
    this.stopElection();
    for (const u of this.subs.splice(0)) u();
    this.link.close();
  }
}
