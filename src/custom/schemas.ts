import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9-]{2,32}$/, 'id: a-z 0-9 -');
const name = z.string().trim().min(1).max(32);

/** §7.2 information role (hidden-word family): what it sees, whom it knows, how it wins. */
export const infoRoleSchema = z.object({
  id,
  nameFa: name,
  emoji: z.string().max(8).default('🎭'),
  team: z.enum(['citizens', 'spies']),
  sees: z.enum(['secret', 'similar', 'none', 'category']),
  knows: z.array(z.string()).default([]),
  win: z.enum(['team', 'solo']).default('team'),
  onEliminated: z.enum(['none', 'guessSecret', 'spyGuessesWitness']).default('none'),
  /** false → the player isn't told their role (e.g. the infiltrator thinks they're a citizen) */
  selfAware: z.boolean().default(true),
  count: z
    .object({ min: z.number().int().min(0).max(16), max: z.number().int().min(0).max(16) })
    .default({ min: 0, max: 1 }),
  descriptionFa: z.string().max(200).default(''),
});
export type InfoRole = z.infer<typeof infoRoleSchema>;

export const NIGHT_ACTIONS = [
  'kill',
  'protect',
  'investigate',
  'block',
  'silence',
  'reveal',
  'swap',
  'convert',
  /** bring a dead player back (Constantine) */
  'revive',
  /** learn how many of N players are mafia (Nostradamus) */
  'predict',
  /** if the target is mafia their role is revealed publicly and the actor dies (Citizen Kane) */
  'expose',
  /** give someone a gun they can fire once during the day (Gunner) */
  'arm',
] as const;
/** ownTeam = self or a teammate; dead = a dead player (revive) */
export const TARGETS = ['self', 'other', 'any', 'teammate', 'ownTeam', 'dead'] as const;
export const PASSIVES = [
  'bulletproof',
  'appearsInnocent',
  'appearsGuilty',
  'revengeKill',
  'immuneToBlock',
  /** their lynch vote counts twice (Mayor) */
  'doubleVote',
  /** cannot be killed at night (Zodiac) */
  'nightImmune',
] as const;
export const DEFAULT_PRIORITY: Record<(typeof NIGHT_ACTIONS)[number], number> = {
  block: 10,
  silence: 15,
  protect: 20,
  swap: 25,
  kill: 35,
  convert: 45,
  investigate: 50,
  predict: 52,
  expose: 58,
  reveal: 60,
  arm: 65,
  revive: 70,
};

export const nightAbilitySchema = z.object({
  action: z.enum(NIGHT_ACTIONS),
  target: z.enum(TARGETS).default('other'),
  /** null = unlimited */
  uses: z.number().int().min(1).max(20).nullable().default(null),
  priority: z.number().int().min(0).max(100).optional(),
  fromNight: z.number().int().min(1).max(10).default(1),
  /** team action (e.g. the mafia's shot): only the highest-ranked living teammate decides */
  shared: z.boolean().default(false),
  /** how many players are picked (predict: up to 3) */
  targets: z.number().int().min(1).max(3).default(1),
  /** usable every N nights (Zodiac shoots every other night) */
  every: z.number().int().min(1).max(4).default(1),
  /** arm: hand out a fake gun (blank rounds) instead of a real one */
  fake: z.boolean().default(false),
});
export type NightAbility = z.infer<typeof nightAbilitySchema>;

/** §7.3 ability role (mafia / werewolf family). `night` may be one ability or a list. */
export const abilityRoleSchema = z.object({
  id,
  nameFa: name,
  emoji: z.string().max(8).default('🎭'),
  team: z.enum(['citizens', 'mafia', 'neutral']),
  night: z
    .union([nightAbilitySchema, z.array(nightAbilitySchema).max(3)])
    .nullable()
    .default(null)
    .transform((n) => (n == null ? [] : Array.isArray(n) ? n : [n])),
  passive: z.array(z.enum(PASSIVES)).default([]),
  knowsTeammates: z.boolean().default(false),
  onWrongKill: z.enum(['none', 'selfDies']).default('none'),
  /** neutral roles only: survive = alive at the end; lynched = jester; lastStanding = serial killer */
  winCondition: z.enum(['team', 'survive', 'lynched', 'lastStanding']).default('team'),
  /** leadership for shared team actions: the highest rank alive decides (godfather > others) */
  rank: z.number().int().min(0).max(10).default(0),
  /** balance weight: positive helps the town, negative helps the mafia */
  weight: z.number().int().min(-10).max(10).default(0),
  descriptionFa: z.string().max(200).default(''),
});
export type AbilityRoleInput = z.input<typeof abilityRoleSchema>;
export type AbilityRole = z.infer<typeof abilityRoleSchema>;
