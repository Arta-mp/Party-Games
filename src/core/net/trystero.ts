import { PeerTransport, type RoomLink } from './transport';

export type TrysteroStrategy = 'nostr' | 'mqtt' | 'torrent';

export interface TrysteroOptions {
  strategy: TrysteroStrategy;
  turn?: { urls: string; username?: string; credential?: string } | null;
}

const APP_ID = 'party-games-fa-v1';

/**
 * Serverless WebRTC via Trystero. Signalling goes over public Nostr relays / MQTT brokers /
 * WebTorrent trackers (switchable in settings if one of them is filtered). Loaded lazily.
 */
export function trysteroLink(opts: TrysteroOptions) {
  return async (roomCode: string): Promise<RoomLink> => {
    const lib =
      opts.strategy === 'mqtt'
        ? await import('@trystero-p2p/mqtt')
        : opts.strategy === 'torrent'
          ? await import('@trystero-p2p/torrent')
          : await import('trystero');
    const room = lib.joinRoom(
      {
        appId: APP_ID,
        ...(opts.turn?.urls ? { turnConfig: [{ urls: opts.turn.urls, username: opts.turn.username, credential: opts.turn.credential }] } : {}),
      },
      `room-${roomCode}`,
    );
    const action = room.makeAction<string>('pg');
    const self = await room.getSelf();
    return {
      selfId: self.peerId,
      send: (data, to) => void action.send(JSON.stringify(data), { target: to ?? null }).catch(() => undefined),
      onData: (cb) => action.onMessage((raw, ctx) => {
        try {
          cb(JSON.parse(raw), ctx.peerId);
        } catch {
          /* ignore garbage */
        }
      }),
      onPeerJoin: (cb) => room.onPeerJoin((c) => cb(c.peerId), { replay: true }),
      onPeerLeave: (cb) => room.onPeerLeave((c) => cb(c.peerId)),
      close: () => void room.leave(),
    };
  };
}

export class TrysteroTransport extends PeerTransport {
  constructor(opts: TrysteroOptions) {
    super(`trystero-${opts.strategy}`, trysteroLink(opts));
  }
}
