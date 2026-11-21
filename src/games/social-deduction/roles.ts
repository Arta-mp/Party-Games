import { abilityRoleSchema, type AbilityRole, type AbilityRoleInput } from '@/custom/schemas';

/** Built-in role packs (§7.3). Every role is plain data validated by the same Zod schema as custom roles. */
const r = (x: AbilityRoleInput): AbilityRole => abilityRoleSchema.parse(x);

export const MAFIA_ROLES = {
  citizen: r({ id: 'citizen', nameFa: 'شهروند ساده', emoji: '🙂', team: 'citizens', weight: 1, descriptionFa: 'توانایی شب ندارد؛ با استدلال و رأی مافیا را پیدا کن.' }),
  doctor: r({ id: 'doctor', nameFa: 'دکتر', emoji: '🩺', team: 'citizens', night: { action: 'protect', target: 'any' }, weight: 3, descriptionFa: 'هر شب یک نفر (یا خودت) را از کشته شدن نجات می‌دهی.' }),
  detective: r({ id: 'detective', nameFa: 'کارآگاه', emoji: '🔎', team: 'citizens', night: { action: 'investigate', target: 'other' }, weight: 4, descriptionFa: 'هر شب استعلام یک نفر را می‌گیری: مافیاست یا نه.' }),
  sniper: r({
    id: 'sniper', nameFa: 'تک‌تیرانداز', emoji: '🎯', team: 'citizens',
    night: { action: 'kill', target: 'other', uses: 1, priority: 40, fromNight: 2 },
    passive: ['appearsInnocent'], onWrongKill: 'selfDies', weight: 2,
    descriptionFa: 'از شب دوم یک تیر داری. اگر به شهروند شلیک کنی خودت می‌میری.',
  }),
  bodyguard: r({ id: 'bodyguard', nameFa: 'رویین‌تن', emoji: '🛡️', team: 'citizens', passive: ['bulletproof'], weight: 2, descriptionFa: 'اولین تیر شب به تو کارگر نیست.' }),
  godfather: r({
    id: 'godfather', nameFa: 'پدرخوانده', emoji: '🎩', team: 'mafia',
    night: { action: 'kill', target: 'other', shared: true, priority: 30 },
    passive: ['appearsInnocent'], knowsTeammates: true, weight: -5,
    descriptionFa: 'رئیس مافیا. استعلامت منفی است.',
  }),
  mafia: r({
    id: 'mafia', nameFa: 'مافیا ساده', emoji: '🔫', team: 'mafia',
    night: { action: 'kill', target: 'other', shared: true, priority: 30 },
    knowsTeammates: true, weight: -3, descriptionFa: 'با هم‌تیمی‌هایت هر شب یک نفر را حذف کن.',
  }),
  silencer: r({
    id: 'silencer', nameFa: 'ناتو', emoji: '🤐', team: 'mafia',
    night: [{ action: 'kill', target: 'other', shared: true, priority: 30 }, { action: 'silence', target: 'other' }],
    knowsTeammates: true, weight: -4, descriptionFa: 'مافیاست و هر شب می‌تواند یک نفر را برای روز بعد ساکت کند.',
  }),
  jester: r({ id: 'jester', nameFa: 'دلقک', emoji: '🤡', team: 'neutral', winCondition: 'lynched', weight: -1, descriptionFa: 'مستقل. اگر روز با رأی اعدام شوی، تنهایی برده‌ای!' }),
};

export const WEREWOLF_ROLES = {
  villager: r({ id: 'villager', nameFa: 'روستایی', emoji: '🧑‍🌾', team: 'citizens', weight: 1, descriptionFa: 'گرگ‌ها را با رأی روز پیدا کن.' }),
  seer: r({ id: 'seer', nameFa: 'پیشگو', emoji: '🔮', team: 'citizens', night: { action: 'investigate', target: 'other' }, weight: 5, descriptionFa: 'هر شب ماهیت یک نفر را می‌بینی.' }),
  witch: r({
    id: 'witch', nameFa: 'جادوگر', emoji: '🧪', team: 'citizens',
    night: [{ action: 'protect', target: 'any', uses: 1 }, { action: 'kill', target: 'other', uses: 1, priority: 38 }],
    weight: 4, descriptionFa: 'یک معجون نجات و یک معجون مرگ برای کل بازی داری.',
  }),
  hunter: r({ id: 'hunter', nameFa: 'شکارچی', emoji: '🏹', team: 'citizens', passive: ['revengeKill'], weight: 3, descriptionFa: 'وقتی بمیری، یک نفر را با خودت می‌بری.' }),
  guard: r({ id: 'guard', nameFa: 'نگهبان', emoji: '💂', team: 'citizens', night: { action: 'protect', target: 'other' }, weight: 3, descriptionFa: 'هر شب از یک نفر (غیر از خودت) محافظت می‌کنی.' }),
  werewolf: r({
    id: 'werewolf', nameFa: 'گرگینه', emoji: '🐺', team: 'mafia',
    night: { action: 'kill', target: 'other', shared: true, priority: 30 },
    knowsTeammates: true, weight: -6, descriptionFa: 'گرگ‌ها با هم هر شب یک روستایی را می‌خورند.',
  }),
};

export const ONE_NIGHT_ROLES = {
  villager: WEREWOLF_ROLES.villager,
  werewolf: r({ ...WEREWOLF_ROLES.werewolf, night: null, descriptionFa: 'گرگ‌های دیگر را می‌شناسی. فقط باید اعدام نشوی.' }),
  seer: r({ id: 'seer', nameFa: 'پیشگو', emoji: '🔮', team: 'citizens', night: { action: 'investigate', target: 'other', uses: 1 }, weight: 4, descriptionFa: 'نقش دقیق یک نفر را می‌بینی (فقط برای خودت).' }),
  swapper: r({
    id: 'swapper', nameFa: 'جابه‌جاگر', emoji: '🔄', team: 'citizens',
    night: { action: 'swap', target: 'other', uses: 1 },
    weight: 2, descriptionFa: 'کارتت را با یک نفر عوض می‌کنی و نقش جدیدت را می‌بینی؛ تیمت هم عوض می‌شود!',
  }),
  jester: MAFIA_ROLES.jester,
};

export type Composition = { role: AbilityRole; n: number }[];

const pack = (roles: Record<string, AbilityRole>, counts: [string, number][]): Composition =>
  counts.filter(([, n]) => n > 0).map(([id, n]) => ({ role: roles[id]!, n }));

/** sensible default composition for `n` players */
export function defaultComposition(kind: 'mafia' | 'werewolf' | 'onenight', n: number): Composition {
  if (kind === 'werewolf') {
    const wolves = Math.max(1, Math.floor(n / 4));
    const specials: [string, number][] = [['werewolf', wolves], ['seer', 1], ['witch', n >= 7 ? 1 : 0], ['hunter', n >= 8 ? 1 : 0], ['guard', n >= 10 ? 1 : 0]];
    return pack(WEREWOLF_ROLES, [...specials, ['villager', n - specials.reduce((s, [, c]) => s + c, 0)]]);
  }
  if (kind === 'onenight') {
    const specials: [string, number][] = [['werewolf', n >= 6 ? 2 : 1], ['seer', 1], ['swapper', n >= 4 ? 1 : 0], ['jester', n >= 7 ? 1 : 0]];
    return pack(ONE_NIGHT_ROLES, [...specials, ['villager', n - specials.reduce((s, [, c]) => s + c, 0)]]);
  }
  const mafia = Math.max(1, Math.floor(n / 4));
  const specials: [string, number][] = [
    ['godfather', 1],
    ['mafia', Math.max(0, mafia - 1 - (n >= 10 ? 1 : 0))],
    ['silencer', n >= 10 ? 1 : 0],
    ['doctor', 1],
    ['detective', n >= 6 ? 1 : 0],
    ['sniper', n >= 8 ? 1 : 0],
    ['bodyguard', n >= 11 ? 1 : 0],
    ['jester', n >= 12 ? 1 : 0],
  ];
  return pack(MAFIA_ROLES, [...specials, ['citizen', n - specials.reduce((s, [, c]) => s + c, 0)]]);
}

export function rolePool(kind: 'mafia' | 'werewolf' | 'onenight'): AbilityRole[] {
  return Object.values(kind === 'werewolf' ? WEREWOLF_ROLES : kind === 'onenight' ? ONE_NIGHT_ROLES : MAFIA_ROLES);
}

/** §7.4 balance indicator: sum of weights. Around 0 is balanced; >0 favours the town. */
export function balance(c: Composition): number {
  return c.reduce((s, x) => s + x.role.weight * x.n, 0);
}

/** composition rules checked before starting (returns an i18n key or null) */
export function checkComposition(c: Composition, players: number): string | null {
  const total = c.reduce((s, x) => s + x.n, 0);
  const mafia = c.filter((x) => x.role.team === 'mafia').reduce((s, x) => s + x.n, 0);
  if (total > players) return 'mafia.err.tooManyRoles';
  if (mafia < 1) return 'mafia.err.noMafia';
  if (mafia * 2 >= players) return 'mafia.err.mafiaHalf';
  const ids = c.map((x) => x.role.id);
  if (new Set(ids).size !== ids.length) return 'mafia.err.duplicateId';
  return null;
}
