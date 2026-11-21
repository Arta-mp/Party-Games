import { packSchema, type Pack, type PackKind, type PackOf, type PackSelection, type ItemOf } from './schema';

// Built-in packs live in content/packs/*.json (PRs welcome). They are validated in CI (content.test.ts).
const modules = import.meta.glob<{ default: unknown }>('./packs/*.json', { eager: true });

export const BUILTIN_PACKS: Pack[] = Object.values(modules).map((m) => packSchema.parse(m.default));

export function builtinPacks<K extends PackKind>(kind: K): PackOf<K>[] {
  return BUILTIN_PACKS.filter((p): p is PackOf<K> => p.kind === kind);
}

export function defaultSelection(kind: PackKind): PackSelection {
  return { builtin: builtinPacks(kind).map((p) => p.id), custom: [] };
}

/** All items of `kind` from the selected built-in + custom packs (falls back to every built-in pack). */
export function itemsOf<K extends PackKind>(kind: K, sel: PackSelection | undefined): ItemOf<K>[] {
  const builtin = builtinPacks(kind);
  const chosen = sel ? builtin.filter((p) => sel.builtin.includes(p.id)) : builtin;
  const custom = (sel?.custom ?? []).filter((p): p is PackOf<K> => p.kind === kind);
  const items = [...chosen, ...custom].flatMap((p) => p.items as ItemOf<K>[]);
  if (items.length > 0) return items;
  return builtin.flatMap((p) => p.items as ItemOf<K>[]);
}
