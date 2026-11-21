import type { ClientMsg, Hello, HostMsg } from './protocol';

export type Unsubscribe = () => void;
export type MessageHandler = (msg: unknown, from: string) => void;
export type PeerHandler = (peerId: string) => void;

/**
 * §4.2 — the only thing the app knows about networking. Swap the adapter (Trystero, BroadcastChannel,
 * in-memory, a future Supabase/Cloudflare one) without touching games or the lobby.
 *
 * On a client, peer events use the id HOST_PEER ('host') when the host appears/disappears,
 * and `join()`'s hello is re-sent automatically every time a (new) host is discovered.
 */
export interface Transport {
  readonly kind: string;
  host(roomCode: string, opts?: { epoch?: number }): Promise<void>;
  join(roomCode: string, hello: Hello): Promise<void>;
  toHost(msg: ClientMsg): void;
  toPeer(peerId: string, msg: HostMsg): void;
  broadcast(msg: HostMsg): void;
  on(event: 'message', cb: MessageHandler): Unsubscribe;
  on(event: 'peer-join' | 'peer-leave', cb: PeerHandler): Unsubscribe;
  leave(): void;
}

export const HOST_PEER = 'host';

/** Minimal room primitive each network adapter provides; PeerTransport adds the host protocol on top. */
export interface RoomLink {
  readonly selfId: string;
  send(data: unknown, to?: string): void;
  onData(cb: (data: unknown, from: string) => void): Unsubscribe;
  onPeerJoin(cb: (peerId: string) => void): Unsubscribe;
  onPeerLeave(cb: (peerId: string) => void): Unsubscribe;
  close(): void;
}

export type LinkFactory = (roomCode: string) => Promise<RoomLink>;

type Wire = { $: 'announce'; epoch: number } | { $: 'm'; d: unknown } | { $: 'who' };

class Emitter {
  private handlers = new Map<string, Set<(...args: never[]) => void>>();
  on(event: string, cb: (...args: never[]) => void): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }
  emit(event: string, ...args: unknown[]) {
    for (const cb of this.handlers.get(event) ?? []) (cb as (...a: unknown[]) => void)(...args);
  }
}

/**
 * Host-announce protocol over any RoomLink:
 * - the host tells every peer that joins `announce(epoch)`; clients pick the announcer with the highest epoch
 *   (a host that was replaced by an election steps down when it hears a higher epoch).
 * - clients queue messages until a host is known.
 */
export class PeerTransport implements Transport {
  private link: RoomLink | null = null;
  private emitter = new Emitter();
  private role: 'host' | 'client' | null = null;
  private epoch = 0;
  private hostPeer: string | null = null;
  private hostEpoch = -1;
  private hello: Hello | null = null;
  private queue: ClientMsg[] = [];
  private subs: Unsubscribe[] = [];

  constructor(
    public readonly kind: string,
    private factory: LinkFactory,
  ) {}

  get selfId() {
    return this.link?.selfId ?? null;
  }

  private async open(roomCode: string) {
    this.leave();
    const link = await this.factory(roomCode);
    this.link = link;
    this.subs.push(
      link.onData((raw, from) => this.onWire(raw as Wire, from)),
      link.onPeerJoin((peer) => {
        if (this.role === 'host') {
          link.send({ $: 'announce', epoch: this.epoch } satisfies Wire, peer);
          this.emitter.emit('peer-join', peer);
        } else {
          link.send({ $: 'who' } satisfies Wire, peer);
        }
      }),
      link.onPeerLeave((peer) => {
        if (this.role === 'host') this.emitter.emit('peer-leave', peer);
        else if (peer === this.hostPeer) {
          this.hostPeer = null;
          this.hostEpoch = -1;
          this.emitter.emit('peer-leave', HOST_PEER);
        }
      }),
    );
    return link;
  }

  private onWire(w: Wire, from: string) {
    if (!w || typeof w !== 'object') return;
    if (w.$ === 'who') {
      if (this.role === 'host') this.link?.send({ $: 'announce', epoch: this.epoch } satisfies Wire, from);
      return;
    }
    if (w.$ === 'announce') {
      if (this.role === 'host') {
        // another host with a newer epoch exists (we were replaced): surface it to the session
        if (w.epoch > this.epoch) this.emitter.emit('message', { t: 'error', code: 'superseded' }, from);
        return;
      }
      if (w.epoch < this.hostEpoch || from === this.hostPeer) return;
      this.hostPeer = from;
      this.hostEpoch = w.epoch;
      if (this.hello) this.link?.send({ $: 'm', d: { t: 'hello', ...this.hello } } satisfies Wire, from);
      for (const m of this.queue.splice(0)) this.link?.send({ $: 'm', d: m } satisfies Wire, from);
      this.emitter.emit('peer-join', HOST_PEER);
      return;
    }
    if (w.$ === 'm') {
      if (this.role === 'client' && from !== this.hostPeer) return; // only trust the host
      this.emitter.emit('message', w.d, this.role === 'client' ? HOST_PEER : from);
    }
  }

  async host(roomCode: string, opts: { epoch?: number } = {}) {
    this.epoch = opts.epoch ?? 0;
    const link = await this.open(roomCode);
    this.role = 'host';
    link.send({ $: 'announce', epoch: this.epoch } satisfies Wire);
  }

  async join(roomCode: string, hello: Hello) {
    this.hello = hello;
    const link = await this.open(roomCode);
    this.role = 'client';
    link.send({ $: 'who' } satisfies Wire);
  }

  toHost(msg: ClientMsg) {
    if (!this.link || !this.hostPeer) {
      if (msg.t !== 'hello') this.queue.push(msg);
      return;
    }
    this.link.send({ $: 'm', d: msg } satisfies Wire, this.hostPeer);
  }

  toPeer(peerId: string, msg: HostMsg) {
    this.link?.send({ $: 'm', d: msg } satisfies Wire, peerId);
  }

  broadcast(msg: HostMsg) {
    this.link?.send({ $: 'm', d: msg } satisfies Wire);
  }

  on(event: 'message' | 'peer-join' | 'peer-leave', cb: MessageHandler | PeerHandler): Unsubscribe {
    return this.emitter.on(event, cb as never);
  }

  leave() {
    for (const u of this.subs.splice(0)) u();
    this.link?.close();
    this.link = null;
    this.role = null;
    this.hostPeer = null;
    this.hostEpoch = -1;
    this.queue = [];
  }
}
