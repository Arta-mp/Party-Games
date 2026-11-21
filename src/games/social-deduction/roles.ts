import { abilityRoleSchema, type AbilityRole, type AbilityRoleInput } from '@/custom/schemas';

/** Built-in role packs (§7.3). Every role is plain data validated by the same Zod schema as custom roles. */
const r = (x: AbilityRoleInput): AbilityRole => abilityRoleSchema.parse(x);

/** shared mafia shot: only the highest-ranked living mafia decides (godfather first) */
const MAFIA_SHOT = { action: 'kill', target: 'other', shared: true, priority: 30 } as const;

export const MAFIA_ROLES = {
  // ---------------------------------------------------------------- town
  citizen: r({
    id: 'citizen',
    nameFa: 'شهروند ساده',
    emoji: '🙂',
    team: 'citizens',
    weight: 1,
    descriptionFa: 'توانایی شب ندارد؛ با استدلال و رأی مافیا را پیدا کن.',
  }),
  doctor: r({
    id: 'doctor',
    nameFa: 'دکتر',
    emoji: '🩺',
    team: 'citizens',
    night: { action: 'protect', target: 'any' },
    weight: 3,
    descriptionFa: 'هر شب یک نفر (یا خودت) را از کشته شدن نجات می‌دهی.',
  }),
  detective: r({
    id: 'detective',
    nameFa: 'کارآگاه',
    emoji: '🔎',
    team: 'citizens',
    night: { action: 'investigate', target: 'other' },
    weight: 4,
    descriptionFa: 'هر شب استعلام یک نفر را می‌گیری: مافیاست یا نه.',
  }),
  sniper: r({
    id: 'sniper',
    nameFa: 'تک‌تیرانداز',
    emoji: '🎯',
    team: 'citizens',
    night: { action: 'kill', target: 'other', uses: 1, priority: 40, fromNight: 2 },
    passive: ['appearsInnocent'],
    onWrongKill: 'selfDies',
    weight: 2,
    descriptionFa: 'از شب دوم یک تیر داری. اگر به شهروند شلیک کنی خودت می‌میری.',
  }),
  professional: r({
    id: 'professional',
    nameFa: 'حرفه‌ای',
    emoji: '🗡️',
    team: 'citizens',
    night: { action: 'kill', target: 'other', priority: 40 },
    onWrongKill: 'selfDies',
    weight: 3,
    descriptionFa: 'هر شب می‌توانی شلیک کنی؛ اگر به شهروند بزنی خودت می‌میری.',
  }),
  bodyguard: r({
    id: 'bodyguard',
    nameFa: 'رویین‌تن',
    emoji: '🛡️',
    team: 'citizens',
    passive: ['bulletproof'],
    weight: 2,
    descriptionFa: 'اولین تیر شب به تو کارگر نیست.',
  }),
  mayor: r({
    id: 'mayor',
    nameFa: 'شهردار',
    emoji: '🎖️',
    team: 'citizens',
    passive: ['doubleVote'],
    weight: 2,
    descriptionFa: 'رأی تو در رأی‌گیری روز دو رأی حساب می‌شود.',
  }),
  // ---------------------------------------------------------------- mafia
  godfather: r({
    id: 'godfather',
    nameFa: 'پدرخوانده',
    emoji: '🎩',
    team: 'mafia',
    rank: 3,
    night: MAFIA_SHOT,
    passive: ['appearsInnocent'],
    knowsTeammates: true,
    weight: -5,
    descriptionFa: 'رئیس مافیا: شلیک شب با توست. استعلامت منفی است.',
  }),
  drLecter: r({
    id: 'dr-lecter',
    nameFa: 'دکتر لکتر',
    emoji: '💉',
    team: 'mafia',
    rank: 1,
    night: [{ action: 'protect', target: 'ownTeam', priority: 20 }, MAFIA_SHOT],
    knowsTeammates: true,
    weight: -4,
    descriptionFa: 'دکتر مافیا: هر شب یک مافیا (یا خودت) را از تیر نجات می‌دهی.',
  }),
  mafia: r({
    id: 'mafia',
    nameFa: 'مافیا ساده',
    emoji: '🔫',
    team: 'mafia',
    rank: 1,
    night: MAFIA_SHOT,
    knowsTeammates: true,
    weight: -3,
    descriptionFa: 'عضو مافیا. اگر رئیس‌ها حذف شوند، شلیک با توست.',
  }),
  silencer: r({
    id: 'silencer',
    nameFa: 'ناتو',
    emoji: '🤐',
    team: 'mafia',
    rank: 2,
    night: [MAFIA_SHOT, { action: 'silence', target: 'other' }],
    knowsTeammates: true,
    weight: -4,
    descriptionFa: 'مافیاست و هر شب می‌تواند یک نفر را برای روز بعد ساکت کند.',
  }),
  negotiator: r({
    id: 'negotiator',
    nameFa: 'مذاکره‌کننده',
    emoji: '🤝',
    team: 'mafia',
    rank: 2,
    night: [{ action: 'convert', target: 'other', uses: 1, fromNight: 2, priority: 45 }, MAFIA_SHOT],
    knowsTeammates: true,
    weight: -5,
    descriptionFa: 'یک بار (از شب دوم) می‌توانی یک شهروند ساده را به مافیا بیاوری؛ روی نقش‌دارها اثر ندارد.',
  }),
  // ---------------------------------------------------------------- independent
  jester: r({
    id: 'jester',
    nameFa: 'دلقک',
    emoji: '🤡',
    team: 'neutral',
    winCondition: 'lynched',
    weight: -1,
    descriptionFa: 'مستقل. اگر روز با رأی اعدام شوی، تنهایی برده‌ای!',
  }),
};

/** roles from popular Iranian scenarios */
export const SCENARIO_ROLES = {
  // «پدرخوانده»
  matador: r({
    id: 'matador',
    nameFa: 'ماتادور',
    emoji: '🐂',
    team: 'mafia',
    rank: 2,
    night: [{ action: 'block', target: 'other' }, MAFIA_SHOT],
    knowsTeammates: true,
    weight: -4,
    descriptionFa: 'هر شب توانایی یک نفر را می‌گیری.',
  }),
  saulGoodman: r({
    id: 'saul-goodman',
    nameFa: 'ساول گودمن',
    emoji: '⚖️',
    team: 'mafia',
    rank: 1,
    night: [{ action: 'convert', target: 'other', uses: 1, priority: 45 }, MAFIA_SHOT],
    knowsTeammates: true,
    weight: -5,
    descriptionFa: 'یک بار یک شهروند ساده را به مافیا می‌خری.',
  }),
  watson: r({
    id: 'watson',
    nameFa: 'دکتر واتسون',
    emoji: '🩺',
    team: 'citizens',
    night: { action: 'protect', target: 'any' },
    weight: 3,
    descriptionFa: 'هر شب یک نفر را نجات می‌دهی.',
  }),
  leon: r({
    id: 'leon',
    nameFa: 'لئون حرفه‌ای',
    emoji: '🔪',
    team: 'citizens',
    night: { action: 'kill', target: 'other', priority: 40 },
    passive: ['bulletproof'],
    onWrongKill: 'selfDies',
    weight: 3,
    descriptionFa: 'هر شب شلیک می‌کنی؛ شلیک به شهروند جان خودت را می‌گیرد. یک جلیقه داری.',
  }),
  kane: r({
    id: 'kane',
    nameFa: 'همشهری کین',
    emoji: '📰',
    team: 'citizens',
    night: { action: 'expose', target: 'other', uses: 1 },
    weight: 3,
    descriptionFa:
      'یک بار یک نفر را نشان می‌کنی؛ اگر مافیا باشد صبح نقشش برای همه اعلام می‌شود و تو کشته می‌شوی.',
  }),
  constantine: r({
    id: 'constantine',
    nameFa: 'کنستانتین',
    emoji: '✝️',
    team: 'citizens',
    night: { action: 'revive', target: 'dead', uses: 1 },
    weight: 3,
    descriptionFa: 'یک بار در بازی یک مرده را زنده می‌کنی.',
  }),
  nostradamus: r({
    id: 'nostradamus',
    nameFa: 'نوستراداموس',
    emoji: '🔮',
    team: 'neutral',
    winCondition: 'survive',
    night: { action: 'predict', target: 'other', targets: 3, uses: 1 },
    passive: ['bulletproof'],
    weight: 0,
    descriptionFa:
      'مستقل. شب اول سه نفر را انتخاب می‌کنی و می‌فهمی چند نفرشان مافیاست. اگر تا آخر زنده بمانی می‌بری.',
  }),
  // «تکاور»
  boss: r({
    id: 'boss',
    nameFa: 'رئیس مافیا',
    emoji: '🕴️',
    team: 'mafia',
    rank: 3,
    night: MAFIA_SHOT,
    passive: ['appearsInnocent'],
    knowsTeammates: true,
    weight: -5,
    descriptionFa: 'شلیک شب با توست؛ استعلامت منفی است.',
  }),
  hostageTaker: r({
    id: 'hostage-taker',
    nameFa: 'گروگان‌گیر',
    emoji: '⛓️',
    team: 'mafia',
    rank: 1,
    night: [{ action: 'block', target: 'other' }, MAFIA_SHOT],
    knowsTeammates: true,
    weight: -4,
    descriptionFa: 'هر شب یک نفر را گروگان می‌گیری و توانایی‌اش را خنثی می‌کنی.',
  }),
  commando: r({
    id: 'commando',
    nameFa: 'تکاور',
    emoji: '🪖',
    team: 'citizens',
    passive: ['bulletproof', 'revengeKill'],
    weight: 3,
    descriptionFa: 'تیر اول شب به تو اثر ندارد و اگر کشته شوی یک نفر را با خودت می‌بری.',
  }),
  guard: r({
    id: 'guard',
    nameFa: 'نگهبان',
    emoji: '💂',
    team: 'citizens',
    night: { action: 'protect', target: 'other' },
    passive: ['immuneToBlock'],
    weight: 3,
    descriptionFa: 'هر شب از یک نفر محافظت می‌کنی؛ گروگان‌گیر روی تو اثر ندارد.',
  }),
  gunner: r({
    id: 'gunner',
    nameFa: 'تفنگدار',
    emoji: '🔫',
    team: 'citizens',
    night: [
      { action: 'arm', target: 'other', uses: 2 },
      { action: 'arm', target: 'other', uses: 2, fake: true },
    ],
    weight: 3,
    descriptionFa:
      'شب‌ها به بقیه تفنگ می‌دهی (۲ واقعی، ۲ مشقی) تا روز یک بار شلیک کنند. خودشان نمی‌دانند تیرشان واقعی است یا نه.',
  }),
  // «زودیاک»
  zodiac: r({
    id: 'zodiac',
    nameFa: 'زودیاک',
    emoji: '♏',
    team: 'neutral',
    winCondition: 'lastStanding',
    night: { action: 'kill', target: 'other', every: 2, priority: 38 },
    passive: ['nightImmune'],
    weight: -4,
    descriptionFa:
      'قاتل مستقل: یک شب در میان شلیک می‌کنی و شب کشته نمی‌شوی. اگر با یک نفر دیگر تنها بمانی می‌بری.',
  }),
};

/** famous Iranian scenarios as role presets (the rest of the seats are plain citizens) */
export interface Scenario {
  id: string;
  nameFa: string;
  roles: [AbilityRole, number][];
}
const R = MAFIA_ROLES;
const S = SCENARIO_ROLES;
export const SCENARIOS: Scenario[] = [
  {
    id: 'classic',
    nameFa: 'کلاسیک',
    roles: [
      [R.godfather, 1],
      [R.drLecter, 1],
      [R.mafia, 1],
      [R.doctor, 1],
      [R.detective, 1],
      [R.sniper, 1],
      [R.bodyguard, 1],
    ],
  },
  {
    id: 'negotiation',
    nameFa: 'مذاکره',
    roles: [
      [R.godfather, 1],
      [R.negotiator, 1],
      [R.mafia, 1],
      [R.doctor, 1],
      [R.detective, 1],
      [R.sniper, 1],
      [R.bodyguard, 1],
      [R.mayor, 1],
    ],
  },
  {
    id: 'godfather',
    nameFa: 'پدرخوانده',
    roles: [
      [R.godfather, 1],
      [S.matador, 1],
      [S.saulGoodman, 1],
      [S.watson, 1],
      [S.leon, 1],
      [S.kane, 1],
      [S.constantine, 1],
      [S.nostradamus, 1],
    ],
  },
  {
    id: 'commando',
    nameFa: 'تکاور',
    roles: [
      [S.boss, 1],
      [R.silencer, 1],
      [S.hostageTaker, 1],
      [S.commando, 1],
      [S.guard, 1],
      [S.gunner, 1],
      [R.doctor, 1],
      [R.detective, 1],
    ],
  },
  {
    id: 'zodiac',
    nameFa: 'زودیاک',
    roles: [
      [R.godfather, 1],
      [R.drLecter, 1],
      [R.mafia, 1],
      [S.zodiac, 1],
      [R.doctor, 1],
      [R.detective, 1],
      [R.bodyguard, 1],
    ],
  },
];

export function scenarioComposition(sc: { roles: [AbilityRole, number][] }, seats: number): Composition {
  const specials = sc.roles.reduce((t, [, n]) => t + n, 0);
  return [
    ...sc.roles.map(([role, n]) => ({ role, n })),
    ...(seats > specials ? [{ role: MAFIA_ROLES.citizen, n: seats - specials }] : []),
  ];
}

export const WEREWOLF_ROLES = {
  villager: r({
    id: 'villager',
    nameFa: 'روستایی',
    emoji: '🧑‍🌾',
    team: 'citizens',
    weight: 1,
    descriptionFa: 'گرگ‌ها را با رأی روز پیدا کن.',
  }),
  seer: r({
    id: 'seer',
    nameFa: 'پیشگو',
    emoji: '🔮',
    team: 'citizens',
    night: { action: 'investigate', target: 'other' },
    weight: 5,
    descriptionFa: 'هر شب ماهیت یک نفر را می‌بینی.',
  }),
  witch: r({
    id: 'witch',
    nameFa: 'جادوگر',
    emoji: '🧪',
    team: 'citizens',
    night: [
      { action: 'protect', target: 'any', uses: 1 },
      { action: 'kill', target: 'other', uses: 1, priority: 38 },
    ],
    weight: 4,
    descriptionFa: 'یک معجون نجات و یک معجون مرگ برای کل بازی داری.',
  }),
  hunter: r({
    id: 'hunter',
    nameFa: 'شکارچی',
    emoji: '🏹',
    team: 'citizens',
    passive: ['revengeKill'],
    weight: 3,
    descriptionFa: 'وقتی بمیری، یک نفر را با خودت می‌بری.',
  }),
  guard: r({
    id: 'guard',
    nameFa: 'نگهبان',
    emoji: '💂',
    team: 'citizens',
    night: { action: 'protect', target: 'other' },
    weight: 3,
    descriptionFa: 'هر شب از یک نفر (غیر از خودت) محافظت می‌کنی.',
  }),
  werewolf: r({
    id: 'werewolf',
    nameFa: 'گرگینه',
    emoji: '🐺',
    team: 'mafia',
    night: { action: 'kill', target: 'other', shared: true, priority: 30 },
    knowsTeammates: true,
    weight: -6,
    descriptionFa: 'گرگ‌ها با هم هر شب یک روستایی را می‌خورند.',
  }),
};

export const ONE_NIGHT_ROLES = {
  villager: WEREWOLF_ROLES.villager,
  werewolf: r({
    ...WEREWOLF_ROLES.werewolf,
    night: null,
    descriptionFa: 'گرگ‌های دیگر را می‌شناسی. فقط باید اعدام نشوی.',
  }),
  seer: r({
    id: 'seer',
    nameFa: 'پیشگو',
    emoji: '🔮',
    team: 'citizens',
    night: { action: 'investigate', target: 'other', uses: 1 },
    weight: 4,
    descriptionFa: 'نقش دقیق یک نفر را می‌بینی (فقط برای خودت).',
  }),
  swapper: r({
    id: 'swapper',
    nameFa: 'جابه‌جاگر',
    emoji: '🔄',
    team: 'citizens',
    night: { action: 'swap', target: 'other', uses: 1 },
    weight: 2,
    descriptionFa: 'کارتت را با یک نفر عوض می‌کنی و نقش جدیدت را می‌بینی؛ تیمت هم عوض می‌شود!',
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
    const specials: [string, number][] = [
      ['werewolf', wolves],
      ['seer', 1],
      ['witch', n >= 7 ? 1 : 0],
      ['hunter', n >= 8 ? 1 : 0],
      ['guard', n >= 10 ? 1 : 0],
    ];
    return pack(WEREWOLF_ROLES, [...specials, ['villager', n - specials.reduce((s, [, c]) => s + c, 0)]]);
  }
  if (kind === 'onenight') {
    const specials: [string, number][] = [
      ['werewolf', n >= 6 ? 2 : 1],
      ['seer', 1],
      ['swapper', n >= 4 ? 1 : 0],
      ['jester', n >= 7 ? 1 : 0],
    ];
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
  if (kind === 'mafia') return [...Object.values(MAFIA_ROLES), ...Object.values(SCENARIO_ROLES)];
  return Object.values(
    kind === 'werewolf' ? WEREWOLF_ROLES : kind === 'onenight' ? ONE_NIGHT_ROLES : MAFIA_ROLES,
  );
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
