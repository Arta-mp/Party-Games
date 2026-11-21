import type { AnyGameModule, FamilyId, GameMeta } from '@/core/engine/types';
import { FAMILIES, META, type GameId } from './meta';

/**
 * Every family and mode. Logic + UI of each family is a separate lazy chunk;
 * only the light metadata (META) is in the main bundle.
 */
const loaders: Record<GameId, () => Promise<AnyGameModule>> = {
  'spy.classic': () => import('./hidden-word/modes').then((m) => m.spyClassic),
  'spy.roles': () => import('./hidden-word/modes').then((m) => m.spyRoles),
  'spy.multi': () => import('./hidden-word/modes').then((m) => m.spyMulti),
  'spy.topic': () => import('./hidden-word/modes').then((m) => m.spyTopic),
  'spy.infiltrator': () => import('./hidden-word/modes').then((m) => m.spyInfiltrator),
  'spy.blank': () => import('./hidden-word/modes').then((m) => m.spyBlank),
  'spy.grid': () => import('./hidden-word/modes').then((m) => m.spyGrid),
  'spy.insider': () => import('./hidden-word/insider').then((m) => m.insider),
  'mafia.moderated': () => import('./social-deduction/modes').then((m) => m.mafiaModerated),
  'mafia.auto': () => import('./social-deduction/modes').then((m) => m.mafiaAuto),
  'mafia.werewolf': () => import('./social-deduction/modes').then((m) => m.werewolf),
  'mafia.onenight': () => import('./social-deduction/modes').then((m) => m.oneNight),
  'word.charades': () => import('./word-guess/modes').then((m) => m.charades),
  'word.forbidden': () => import('./word-guess/modes').then((m) => m.forbidden),
  'word.forehead': () => import('./word-guess/modes').then((m) => m.forehead),
  'word.drawing': () => import('./word-guess/drawing').then((m) => m.drawing),
  'word.unique': () => import('./word-guess/unique').then((m) => m.uniqueClue),
  'board.codewords': () => import('./team-board/codewords').then((m) => m.codewords),
  'board.duet': () => import('./team-board/duet').then((m) => m.duet),
  'board.spectrum': () => import('./team-board/spectrum').then((m) => m.spectrum),
  'party.esmfamil': () => import('./party/esmfamil').then((m) => m.esmFamil),
  'party.liar': () => import('./party/liar').then((m) => m.liar),
  'party.mostlikely': () => import('./party/mostlikely').then((m) => m.mostLikely),
  'party.truthdare': () => import('./party/truthdare').then((m) => m.truthDare),
};

const cache = new Map<string, Promise<AnyGameModule>>();

export function isGameId(id: string): id is GameId {
  return id in META;
}

export function loadGame(id: string): Promise<AnyGameModule> {
  if (!isGameId(id)) return Promise.reject(new Error(`unknown game ${id}`));
  let p = cache.get(id);
  if (!p) {
    p = loaders[id]();
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return p;
}

export function gamesOf(family: FamilyId): GameMeta[] {
  return Object.values(META).filter((m) => m.family === family);
}

export function playable(meta: GameMeta, players: number, mode: 'online' | 'local'): boolean {
  if (mode === 'local' && !meta.supportsPassAndPlay) return false;
  if (mode === 'online' && !meta.supportsOnline) return false;
  return players >= meta.minPlayers && players <= meta.maxPlayers;
}

export { FAMILIES, META, type GameId };
