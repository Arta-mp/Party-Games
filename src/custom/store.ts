import { create } from 'zustand';
import { z } from 'zod';
import { packSchema, type Pack } from '@/content/schema';
import { readJSON, writeJSON } from '@/lib/storage';
import { abilityRoleSchema, infoRoleSchema, type AbilityRole, type InfoRole } from './schemas';

/** User-made content, saved on this device (localStorage). Shared via export JSON / share links. */
interface CustomState {
  packs: Pack[];
  infoRoles: InfoRole[];
  abilityRoles: AbilityRole[];
  savePack(p: Pack): void;
  removePack(id: string): void;
  saveInfoRole(r: InfoRole): void;
  removeInfoRole(id: string): void;
  saveAbilityRole(r: AbilityRole): void;
  removeAbilityRole(id: string): void;
}

const KEY = 'pg:custom';
const stored = readJSON<unknown>(KEY, {});
const parsed = z
  .object({
    packs: z.array(packSchema).catch([]).default([]),
    infoRoles: z.array(infoRoleSchema).catch([]).default([]),
    abilityRoles: z.array(abilityRoleSchema).catch([]).default([]),
  })
  .catch({ packs: [], infoRoles: [], abilityRoles: [] })
  .parse(stored);

const upsert = <T extends { id: string }>(list: T[], item: T) => [
  ...list.filter((x) => x.id !== item.id),
  item,
];

export const useCustom = create<CustomState>((set, get) => {
  const persist = () => {
    const { packs, infoRoles, abilityRoles } = get();
    writeJSON(KEY, { packs, infoRoles, abilityRoles });
  };
  const update = (patch: Partial<CustomState>) => {
    set(patch);
    persist();
  };
  return {
    ...parsed,
    savePack: (p) => update({ packs: upsert(get().packs, p) }),
    removePack: (id) => update({ packs: get().packs.filter((p) => p.id !== id) }),
    saveInfoRole: (r) => update({ infoRoles: upsert(get().infoRoles, r) }),
    removeInfoRole: (id) => update({ infoRoles: get().infoRoles.filter((r) => r.id !== id) }),
    saveAbilityRole: (r) => update({ abilityRoles: upsert(get().abilityRoles, r) }),
    removeAbilityRole: (id) => update({ abilityRoles: get().abilityRoles.filter((r) => r.id !== id) }),
  };
});
