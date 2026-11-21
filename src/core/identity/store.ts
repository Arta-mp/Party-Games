import { create } from 'zustand';
import { readJSON, writeJSON } from '@/lib/storage';
import { cleanName, newDeviceId, validateName } from './identity';

interface IdentityState {
  name: string | null;
  deviceId: string;
  setName(name: string): boolean;
}

const KEY = 'pg:identity';
/** A tab may carry its own identity in sessionStorage (several players in one browser, used by multi-tab tests). */
function tabIdentity(): { name: string | null; deviceId?: string } | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
const tab = tabIdentity();
const saved = tab ?? readJSON<{ name: string | null; deviceId?: string }>(KEY, { name: null });
const deviceId = saved.deviceId ?? newDeviceId();
if (!tab) writeJSON(KEY, { name: saved.name, deviceId });

export const useIdentity = create<IdentityState>((set) => ({
  name: saved.name,
  deviceId,
  setName(raw) {
    const name = cleanName(raw);
    if (validateName(name) !== 'ok') return false;
    if (tab) globalThis.sessionStorage.setItem(KEY, JSON.stringify({ name, deviceId }));
    else writeJSON(KEY, { name, deviceId });
    set({ name });
    return true;
  },
}));
