import { create } from 'zustand';
import { readJSON, writeJSON } from '@/lib/storage';

export type Lang = 'fa' | 'en';
export type TransportKind = 'nostr' | 'mqtt' | 'torrent' | 'broadcast';

export interface Settings {
  theme: 'dark' | 'light';
  lang: Lang;
  sound: boolean;
  vibration: boolean;
  transport: TransportKind;
  /** optional TURN server for strict mobile NATs */
  turnUrl: string;
  turnUser: string;
  turnPass: string;
  tutorialSeen: boolean;
}

const KEY = 'pg:settings';
const DEFAULTS: Settings = {
  theme: 'dark',
  lang: 'fa',
  sound: true,
  vibration: true,
  transport: 'nostr',
  turnUrl: '',
  turnUser: '',
  turnPass: '',
  tutorialSeen: false,
};

/** `?transport=broadcast` lets tests/devs pick a transport without touching settings. */
function urlTransport(): TransportKind | null {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '');
    const t = q.get('transport');
    return t === 'nostr' || t === 'mqtt' || t === 'torrent' || t === 'broadcast' ? t : null;
  } catch {
    return null;
  }
}

const initial: Settings = { ...DEFAULTS, ...readJSON<Partial<Settings>>(KEY, {}) };
const forced = urlTransport();
if (forced) initial.transport = forced;

export const useSettings = create<Settings & { set(p: Partial<Settings>): void }>((set, get) => ({
  ...initial,
  set(patch) {
    set(patch);
    const { set: _s, ...rest } = { ...get(), ...patch };
    writeJSON(KEY, rest);
  },
}));
