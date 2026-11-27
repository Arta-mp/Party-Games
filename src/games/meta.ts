import type { FamilyId, GameMeta } from '@/core/engine/types';

const m = (
  id: string,
  family: FamilyId,
  emoji: string,
  minPlayers: number,
  maxPlayers: number,
  phase: number,
  extra: Partial<GameMeta> = {},
): GameMeta => ({
  id,
  family,
  emoji,
  minPlayers,
  maxPlayers,
  phase,
  supportsPassAndPlay: true,
  supportsOnline: true,
  supportsCustomRoles: false,
  ...extra,
});

/** Lightweight metadata of every mode (the game logic itself is lazy-loaded via registry.ts). */
export const META = {
  'spy.classic': m('spy.classic', 'hidden-word', '🕵️', 3, 12, 1, { supportsCustomRoles: true }),
  'spy.roles': m('spy.roles', 'hidden-word', '🎭', 4, 12, 1, { supportsCustomRoles: true }),
  'spy.multi': m('spy.multi', 'hidden-word', '👥', 6, 16, 1, { supportsCustomRoles: true }),
  'spy.topic': m('spy.topic', 'hidden-word', '🍕', 3, 12, 1, { supportsCustomRoles: true }),
  'spy.infiltrator': m('spy.infiltrator', 'hidden-word', '🫥', 4, 12, 2),
  'spy.blank': m('spy.blank', 'hidden-word', '⬜', 5, 12, 2),
  'spy.grid': m('spy.grid', 'hidden-word', '🔲', 3, 8, 4),
  'spy.insider': m('spy.insider', 'hidden-word', '🧭', 4, 8, 4),

  'mafia.moderated': m('mafia.moderated', 'social-deduction', '🎙️', 6, 20, 3, { supportsCustomRoles: true }),
  'mafia.auto': m('mafia.auto', 'social-deduction', '🔫', 5, 16, 3, { supportsCustomRoles: true }),
  'mafia.werewolf': m('mafia.werewolf', 'social-deduction', '🐺', 6, 20, 3, { supportsCustomRoles: true }),
  'mafia.onenight': m('mafia.onenight', 'social-deduction', '🌙', 3, 10, 3, { supportsCustomRoles: true }),

  'word.charades': m('word.charades', 'word-guess', '🤸', 4, 30, 4),
  'word.forbidden': m('word.forbidden', 'word-guess', '🚫', 4, 30, 4),
  'word.forehead': m('word.forehead', 'word-guess', '🤔', 2, 30, 4),
  'word.drawing': m('word.drawing', 'word-guess', '🎨', 3, 16, 5),
  'word.unique': m('word.unique', 'word-guess', '☝️', 3, 10, 5),

  'board.codewords': m('board.codewords', 'team-board', '🟥', 4, 20, 5),
  'board.duet': m('board.duet', 'team-board', '🤝', 2, 2, 5),
  'board.spectrum': m('board.spectrum', 'team-board', '🌈', 3, 20, 5),

  'party.esmfamil': m('party.esmfamil', 'party', '📝', 2, 16, 2),
  'party.liar': m('party.liar', 'party', '🤥', 3, 10, 5),
  'party.mostlikely': m('party.mostlikely', 'party', '👉', 3, 20, 2),
  'party.truthdare': m('party.truthdare', 'party', '🎲', 2, 20, 2),

  'cards.holdem': m('cards.holdem', 'card', '🃏', 2, 10, 7),
} satisfies Record<string, GameMeta>;

export type GameId = keyof typeof META;

export interface FamilyInfo {
  id: FamilyId;
  emoji: string;
}

export const FAMILIES: FamilyInfo[] = [
  { id: 'hidden-word', emoji: '🕵️' },
  { id: 'social-deduction', emoji: '🔪' },
  { id: 'word-guess', emoji: '🗣️' },
  { id: 'team-board', emoji: '🧩' },
  { id: 'party', emoji: '🎉' },
  { id: 'card', emoji: '♠️' },
];
