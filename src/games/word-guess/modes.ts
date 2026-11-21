import { z } from 'zod';
import { itemsOf } from '@/content/builtin';
import { packSelection } from '@/content/schema';
import type { GameModule } from '@/core/engine/types';
import { META } from '../meta';
import { pendingWG, reduceWG, resultWG, setupWG, viewWG, wgAction, wgBaseConfig, type Card, type WGAction, type WGState, type WGView } from './core';
import { makeWGSetup, WordGuessPlay } from './ui';

const filters = {
  categories: z.array(z.string()).default([]),
  /** 0 = any */
  difficulty: z.number().int().min(0).max(3).default(0),
};

function wordsDeck(sel: z.infer<typeof packSelection>, categories: string[], difficulty: number): Card[] {
  const all = itemsOf('words', sel);
  const filtered = all.filter((w) => (categories.length === 0 || (w.category && categories.includes(w.category))) && (!difficulty || w.difficulty === difficulty));
  return (filtered.length ? filtered : all).map((w) => ({ word: w.word, extra: [], category: w.category ?? null }));
}

const charadesCfg = z.object({ ...wgBaseConfig, ...filters, packs: packSelection.default({ builtin: ['charades-fa'], custom: [] }) });
type CharadesCfg = z.infer<typeof charadesCfg>;

function make<C extends z.infer<z.ZodObject<typeof wgBaseConfig>>>(
  id: 'word.charades' | 'word.forbidden' | 'word.forehead',
  schema: z.ZodType<C>,
  deck: (c: C) => Card[],
  extra: Parameters<typeof setupWG>[6],
): GameModule<C, WGState, WGAction, WGView> {
  const meta = META[id];
  return {
    id,
    family: 'word-guess',
    meta,
    configSchema: schema,
    actionSchema: wgAction,
    defaultConfig: schema.parse({}),
    setup: (players, cfg, rng, opts) => setupWG(id, players, cfg, deck(cfg), opts, rng, extra),
    reduce: reduceWG,
    viewFor: viewWG,
    result: resultWG,
    pending: pendingWG,
    deadline: (s) => (s.phase === 'turn' ? s.endsAt : null),
    validate: (cfg, n) => {
      if (n < meta.minPlayers) return { k: 'err.minPlayers', p: { n: meta.minPlayers } };
      if (cfg.teams > 0 && n < cfg.teams * 2) return { k: 'wg.err.teamSize', p: { n: cfg.teams * 2 } };
      return null;
    },
    screens: { Setup: makeWGSetup(id), Play: WordGuessPlay },
  };
}

export const charades = make<CharadesCfg>('word.charades', charadesCfg, (c) => wordsDeck(c.packs, c.categories, c.difficulty), { visibility: 'performer+opponents', allowBuzz: false });

const forbiddenCfg = z.object({ ...wgBaseConfig, packs: packSelection.default({ builtin: ['forbidden-fa'], custom: [] }) });
export const forbidden = make<z.infer<typeof forbiddenCfg>>(
  'word.forbidden',
  forbiddenCfg,
  (c) => itemsOf('cards', c.packs).map((x) => ({ word: x.word, extra: x.forbidden, category: null })),
  { visibility: 'performer+opponents', allowBuzz: true },
);

const foreheadCfg = z.object({ ...wgBaseConfig, teams: z.number().int().min(0).max(4).default(0), ...filters, packs: packSelection.default({ builtin: ['topics-fa', 'charades-fa'], custom: [] }) });
export const forehead = make<z.infer<typeof foreheadCfg>>('word.forehead', foreheadCfg, (c) => wordsDeck(c.packs, c.categories, c.difficulty), { visibility: 'everyone', allowBuzz: false });
