import { z } from 'zod';

const text = z.string().trim().min(1).max(80);

export const locationItem = z.object({ name: text, roles: z.array(text).min(3).max(12) });
export const wordItem = z.object({
  word: text,
  category: text.optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});
export const pairItem = z.object({ a: text, b: text });
export const gridItem = z.object({ topic: text, words: z.array(text).length(16) });
export const cardItem = z.object({ word: text, forbidden: z.array(text).length(5) });
export const spectrumItem = z.object({ left: text, right: text });
export const questionItem = z.object({
  q: z.string().trim().min(3).max(240),
  level: z.enum(['family', 'friends', 'spicy']).optional(),
  type: z.enum(['truth', 'dare']).optional(),
});
export const triviaItem = z.object({ q: z.string().trim().min(5).max(240), answer: text });
export const columnItem = z.object({ name: text });

const base = {
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  nameFa: text,
  author: z.string().max(60).optional(),
};

export const packSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('locations'), items: z.array(locationItem).min(1) }),
  z.object({ ...base, kind: z.literal('words'), items: z.array(wordItem).min(1) }),
  z.object({ ...base, kind: z.literal('pairs'), items: z.array(pairItem).min(1) }),
  z.object({ ...base, kind: z.literal('grids'), items: z.array(gridItem).min(1) }),
  z.object({ ...base, kind: z.literal('cards'), items: z.array(cardItem).min(1) }),
  z.object({ ...base, kind: z.literal('spectrums'), items: z.array(spectrumItem).min(1) }),
  z.object({ ...base, kind: z.literal('questions'), items: z.array(questionItem).min(1) }),
  z.object({ ...base, kind: z.literal('trivia'), items: z.array(triviaItem).min(1) }),
  z.object({ ...base, kind: z.literal('columns'), items: z.array(columnItem).min(1) }),
]);

export type Pack = z.infer<typeof packSchema>;
export type PackKind = Pack['kind'];
export type PackOf<K extends PackKind> = Extract<Pack, { kind: K }>;
export type ItemOf<K extends PackKind> = PackOf<K>['items'][number];

/** selection of packs inside a game config: built-in ids + embedded custom packs */
export const packSelection = z.object({
  builtin: z.array(z.string()).default([]),
  custom: z.array(packSchema).default([]),
});
export type PackSelection = z.infer<typeof packSelection>;
