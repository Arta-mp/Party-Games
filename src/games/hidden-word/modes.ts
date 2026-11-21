import { z } from 'zod';
import type { Rng } from '@/core/engine/rng';
import { itemsOf } from '@/content/builtin';
import { packSelection } from '@/content/schema';
import { META } from '../meta';
import { HiddenWordPlay, makeHiddenWordSetup, type HWPackKind } from './ui';
import { baseConfig, BLANK, CITIZEN, INFILTRATOR, makeHWModule, SPY, TOPIC_SPY, type Deal } from './core';

const screensFor = (k: HWPackKind) => ({ Setup: makeHiddenWordSetup(k), Play: HiddenWordPlay });
const sel = (kind: Parameters<typeof itemsOf>[0]) => packSelection.default({ builtin: [], custom: [] }).describe(kind);

// ------------------------------------------------------------ جاسوس کلاسیک
const classicCfg = z.object({ ...baseConfig, packs: sel('locations') });
type ClassicCfg = z.infer<typeof classicCfg>;

function locationDeal(cfg: { packs: ClassicCfg['packs'] }, rng: Rng, withRoles: boolean, spies: number): Deal {
  const locations = itemsOf('locations', cfg.packs);
  const loc = rng.pick(locations);
  return {
    roles: [{ role: SPY, n: spies }],
    secret: loc.name,
    similar: null,
    category: null,
    grid: null,
    guessOptions: locations.map((l) => l.name),
    subroles: withRoles ? loc.roles : null,
  };
}

export const spyClassic = makeHWModule<ClassicCfg>({
  meta: META['spy.classic'],
  configSchema: classicCfg,
  defaultConfig: classicCfg.parse({}),
  elimination: 'single',
  spyGuessAnytime: true,
  deal: (cfg, rng) => locationDeal(cfg, rng, false, 1),
  screens: screensFor('locations'),
});

// ------------------------------------------------------------ جاسوس با نقش
export const spyRoles = makeHWModule<ClassicCfg>({
  meta: META['spy.roles'],
  configSchema: classicCfg,
  defaultConfig: classicCfg.parse({}),
  elimination: 'single',
  spyGuessAnytime: true,
  deal: (cfg, rng) => locationDeal(cfg, rng, true, 1),
  screens: screensFor('locations'),
});

// ------------------------------------------------------------ چند جاسوس
const multiCfg = z.object({
  ...baseConfig,
  packs: sel('locations'),
  spyCount: z.number().int().min(2).max(3).default(2),
  spiesKnowEachOther: z.boolean().default(true),
  withRoles: z.boolean().default(false),
});
type MultiCfg = z.infer<typeof multiCfg>;

export const spyMulti = makeHWModule<MultiCfg>({
  meta: META['spy.multi'],
  configSchema: multiCfg,
  defaultConfig: multiCfg.parse({}),
  elimination: 'single',
  spyGuessAnytime: true,
  deal: (cfg, rng) => {
    const d = locationDeal(cfg, rng, cfg.withRoles, cfg.spyCount);
    const spy = { ...SPY, knows: cfg.spiesKnowEachOther ? ['spy'] : [] };
    return { ...d, roles: [{ role: spy, n: cfg.spyCount }] };
  },
  screens: screensFor('locations'),
});

// ------------------------------------------------------------ جاسوس موضوعی
const topicCfg = z.object({
  ...baseConfig,
  packs: sel('words'),
  /** empty = every category */
  categories: z.array(z.string()).default([]),
});
type TopicCfg = z.infer<typeof topicCfg>;

export const spyTopic = makeHWModule<TopicCfg>({
  meta: META['spy.topic'],
  configSchema: topicCfg,
  defaultConfig: topicCfg.parse({}),
  elimination: 'single',
  spyGuessAnytime: true,
  deal: (cfg, rng) => {
    const words = itemsOf('words', cfg.packs).filter((w) => w.category);
    const cats = [...new Set(words.map((w) => w.category!))].filter(
      (c) => cfg.categories.length === 0 || cfg.categories.includes(c),
    );
    const category = rng.pick(cats.length ? cats : [...new Set(words.map((w) => w.category!))]);
    const inCat = words.filter((w) => w.category === category).map((w) => w.word);
    return {
      roles: [{ role: TOPIC_SPY, n: 1 }],
      secret: rng.pick(inCat),
      similar: null,
      category,
      grid: null,
      guessOptions: inCat,
      subroles: null,
    };
  },
  screens: screensFor('words'),
});

// ------------------------------------------------------------ نفوذی (کلمه‌ی شبیه)
const infCfg = z.object({
  ...baseConfig,
  roundSeconds: z.number().int().min(0).max(1800).default(120),
  packs: sel('pairs'),
  infiltrators: z.number().int().min(0).max(3).default(1),
  blanks: z.number().int().min(0).max(2).default(0),
});
type InfCfg = z.infer<typeof infCfg>;

function pairDeal(cfg: InfCfg, rng: Rng): Deal {
  const pair = rng.pick(itemsOf('pairs', cfg.packs));
  const flip = rng.chance(0.5);
  return {
    roles: [
      // in this mode nobody is told their role: a labelled citizen would expose the infiltrator
      { role: { ...CITIZEN, selfAware: false }, n: 0 },
      { role: INFILTRATOR, n: cfg.infiltrators },
      { role: BLANK, n: cfg.blanks },
    ],
    secret: flip ? pair.b : pair.a,
    similar: flip ? pair.a : pair.b,
    category: null,
    grid: null,
    guessOptions: null,
    subroles: null,
  };
}

const needsOne = (c: InfCfg) => (c.infiltrators + c.blanks < 1 ? { k: 'err.needOneSpy' } : null);

export const spyInfiltrator = makeHWModule<InfCfg>({
  meta: META['spy.infiltrator'],
  configSchema: infCfg,
  defaultConfig: infCfg.parse({}),
  elimination: 'multi',
  spyGuessAnytime: false,
  deal: pairDeal,
  validate: needsOne,
  screens: screensFor('pairs'),
});

// ------------------------------------------------------------ بی‌کلمه
export const spyBlank = makeHWModule<InfCfg>({
  meta: META['spy.blank'],
  configSchema: infCfg,
  defaultConfig: infCfg.parse({ blanks: 1, infiltrators: 1 }),
  elimination: 'multi',
  spyGuessAnytime: false,
  deal: pairDeal,
  validate: needsOne,
  screens: screensFor('pairs'),
});

// ------------------------------------------------------------ شانزده‌خانه (جدول ۱۶ کلمه‌ای)
const gridCfg = z.object({ ...baseConfig, roundSeconds: z.number().int().min(0).max(1800).default(180), packs: sel('grids') });
type GridCfg = z.infer<typeof gridCfg>;

export const spyGrid = makeHWModule<GridCfg>({
  meta: META['spy.grid'],
  configSchema: gridCfg,
  defaultConfig: gridCfg.parse({}),
  elimination: 'single',
  spyGuessAnytime: false,
  deal: (cfg, rng) => {
    const g = rng.pick(itemsOf('grids', cfg.packs));
    return {
      roles: [{ role: TOPIC_SPY, n: 1 }],
      secret: rng.pick(g.words),
      similar: null,
      category: g.topic,
      grid: g.words,
      guessOptions: g.words,
      subroles: null,
    };
  },
  screens: screensFor('grids'),
});
