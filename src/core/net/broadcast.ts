import { PeerTransport, type RoomLink } from './transport';

/**
 * Same-browser transport over BroadcastChannel (several tabs = several phones).
 * Used by the Playwright multi-tab tests and handy for local development; never leaves the device.
 */
type Frame =
  | { k: 'hi'; from: string }
  | { k: 'here'; from: string; to: string }
  | { k: 'beat'; from: string }
  | { k: 'bye'; from: string }
  | { k: 'data'; from: string; to: string | null; data: unknown };

const BEAT_MS = 1000;
const TIMEOUT_MS = 4000;

export function broadcastLink(roomCode: string): Promise<RoomLink> {
  const selfId = `bc-${Math.random().toString(36).slice(2, 10)}`;
  const ch = new BroadcastChannel(`party-games:${roomCode}`);
  const peers = new Map<string, number>();
  const on = { data: new Set<(d: unknown, f: string) => void>(), join: new Set<(p: string) => void>(), leave: new Set<(p: string) => void>() };
  const post = (f: Frame) => ch.postMessage(f);
  const seen = (id: string) => {
    const isNew = !peers.has(id);
    peers.set(id, Date.now());
    if (isNew) for (const cb of on.join) cb(id);
  };
  const gone = (id: string) => {
    if (peers.delete(id)) for (const cb of on.leave) cb(id);
  };
  ch.onmessage = (e: MessageEvent<Frame>) => {
    const f = e.data;
    if (!f || f.from === selfId) return;
    switch (f.k) {
      case 'hi':
        seen(f.from);
        post({ k: 'here', from: selfId, to: f.from });
        break;
      case 'here':
        if (f.to === selfId) seen(f.from);
        break;
      case 'beat':
        seen(f.from);
        break;
      case 'bye':
        gone(f.from);
        break;
      case 'data':
        if (f.to && f.to !== selfId) return;
        seen(f.from);
        for (const cb of on.data) cb(f.data, f.from);
        break;
    }
  };
  const beat = setInterval(() => {
    post({ k: 'beat', from: selfId });
    const now = Date.now();
    for (const [id, t] of peers) if (now - t > TIMEOUT_MS) gone(id);
  }, BEAT_MS);
  const onHide = () => post({ k: 'bye', from: selfId });
  globalThis.addEventListener?.('pagehide', onHide);
  post({ k: 'hi', from: selfId });
  let closed = false;
  return Promise.resolve({
    selfId,
    send: (data, to) => !closed && post({ k: 'data', from: selfId, to: to ?? null, data }),
    onData: (cb) => (on.data.add(cb), () => void on.data.delete(cb)),
    onPeerJoin: (cb) => (on.join.add(cb), () => void on.join.delete(cb)),
    onPeerLeave: (cb) => (on.leave.add(cb), () => void on.leave.delete(cb)),
    close() {
      if (closed) return;
      closed = true;
      post({ k: 'bye', from: selfId });
      clearInterval(beat);
      globalThis.removeEventListener?.('pagehide', onHide);
      ch.close();
    },
  });
}

export class BroadcastTransport extends PeerTransport {
  constructor() {
    super('broadcast', broadcastLink);
  }
}
