import { create } from 'zustand';
import { readJSON, writeJSON } from '@/lib/storage';
import { cleanName, newDeviceId, validateName } from './identity';

interface IdentityState {
  name: string | null;
  deviceId: string;
  setName(name: string): boolean;
}

const KEY = 'pg:identity';
const saved = readJSON<{ name: string | null; deviceId?: string }>(KEY, { name: null });
const deviceId = saved.deviceId ?? newDeviceId();
writeJSON(KEY, { name: saved.name, deviceId });

export const useIdentity = create<IdentityState>((set) => ({
  name: saved.name,
  deviceId,
  setName(raw) {
    const name = cleanName(raw);
    if (validateName(name) !== 'ok') return false;
    writeJSON(KEY, { name, deviceId });
    set({ name });
    return true;
  },
}));
