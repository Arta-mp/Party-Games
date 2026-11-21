import { itemsOf } from '@/content/builtin';
import type { PackSelection } from '@/content/schema';

/** special source id for the locations packs; every other source is a word category */
export const LOCATIONS_SOURCE = '$locations';
export const LOCATIONS_LABEL = 'مکان';

export interface SecretGroup {
  id: string;
  label: string;
  words: string[];
  roles: Record<string, string[]> | null;
}

export function secretGroups(cfg: { packs?: PackSelection; wordPacks?: PackSelection }): SecretGroup[] {
  const locations = itemsOf('locations', cfg.packs);
  const groups: SecretGroup[] = [
    {
      id: LOCATIONS_SOURCE,
      label: LOCATIONS_LABEL,
      words: locations.map((l) => l.name),
      roles: Object.fromEntries(locations.map((l) => [l.name, l.roles])),
    },
  ];
  const byCat = new Map<string, string[]>();
  // default to the topics pack: other word packs reuse category names and would add duplicates
  for (const w of itemsOf('words', cfg.wordPacks ?? { builtin: ['topics-fa'], custom: [] })) {
    if (!w.category) continue;
    byCat.set(w.category, [...(byCat.get(w.category) ?? []), w.word]);
  }
  for (const [cat, list] of byCat) {
    const words = [...new Set(list)];
    if (words.length >= 4) groups.push({ id: cat, label: cat, words, roles: null });
  }
  return groups;
}
