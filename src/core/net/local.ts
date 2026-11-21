import { PeerTransport, type RoomLink } from './transport';

/**
 * In-memory network: every LocalTransport created from the same hub can talk to each other.
 * Used for unit tests (many simulated phones in one process) and anywhere no network is wanted.
 * Delivery is async (microtask) like a real network.
 */
export class LocalHub {
  private rooms = new Map<string, Map<string, LocalLink>>();
  private seq = 0;
  /** every raw delivery, for secrecy tests */
  readonly log: { room: string; from: string; to: string; data: unknown }[] = [];

  link(roomCode: string): Promise<RoomLink> {
    const room = this.rooms.get(roomCode) ?? new Map<string, LocalLink>();
    this.rooms.set(roomCode, room);
    const link = new LocalLink(`peer${++this.seq}`, this, roomCode);
    const others = [...room.values()];
    room.set(link.selfId, link);
    queueMicrotask(() => {
      for (const o of others) {
        if (!room.has(o.selfId) || !room.has(link.selfId)) continue;
        o.fire('join', link.selfId);
        link.fire('join', o.selfId);
      }
    });
    return Promise.resolve(link);
  }

  deliver(roomCode: string, from: string, to: string | undefined, data: unknown) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    const payload = JSON.parse(JSON.stringify(data)) as unknown; // like the wire: no shared references
    const targets = to ? [room.get(to)].filter(Boolean) : [...room.values()].filter((l) => l.selfId !== from);
    for (const t of targets) {
      this.log.push({ room: roomCode, from, to: t!.selfId, data: payload });
      queueMicrotask(() => room.get(t!.selfId) && t!.fire('data', payload, from));
    }
  }

  remove(roomCode: string, id: string) {
    const room = this.rooms.get(roomCode);
    if (!room?.delete(id)) return;
    queueMicrotask(() => {
      for (const o of room.values()) o.fire('leave', id);
    });
  }

  /** simulates a phone losing its connection */
  drop(peerId: string) {
    for (const [code, room] of this.rooms) if (room.has(peerId)) this.remove(code, peerId);
  }
}

type Ev = 'data' | 'join' | 'leave';

class LocalLink implements RoomLink {
  private handlers: Record<Ev, Set<(...a: never[]) => void>> = {
    data: new Set(),
    join: new Set(),
    leave: new Set(),
  };
  constructor(
    public readonly selfId: string,
    private hub: LocalHub,
    private room: string,
  ) {}
  fire(ev: Ev, ...args: unknown[]) {
    for (const h of this.handlers[ev]) (h as (...a: unknown[]) => void)(...args);
  }
  private sub(ev: Ev, cb: (...a: never[]) => void) {
    this.handlers[ev].add(cb);
    return () => void this.handlers[ev].delete(cb);
  }
  send(data: unknown, to?: string) {
    this.hub.deliver(this.room, this.selfId, to, data);
  }
  onData(cb: (data: unknown, from: string) => void) {
    return this.sub('data', cb);
  }
  onPeerJoin(cb: (peer: string) => void) {
    return this.sub('join', cb);
  }
  onPeerLeave(cb: (peer: string) => void) {
    return this.sub('leave', cb);
  }
  close() {
    this.hub.remove(this.room, this.selfId);
  }
}

export class LocalTransport extends PeerTransport {
  constructor(hub: LocalHub) {
    super('local', (code) => hub.link(code));
  }
}
