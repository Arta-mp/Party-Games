import type { Settings } from '@/app/settings';
import { BroadcastTransport } from './broadcast';
import { TrysteroTransport } from './trystero';
import type { Transport } from './transport';

export function createTransport(s: Pick<Settings, 'transport' | 'turnUrl' | 'turnUser' | 'turnPass'>): Transport {
  if (s.transport === 'broadcast') return new BroadcastTransport();
  return new TrysteroTransport({
    strategy: s.transport,
    turn: s.turnUrl ? { urls: s.turnUrl, username: s.turnUser || undefined, credential: s.turnPass || undefined } : null,
  });
}
