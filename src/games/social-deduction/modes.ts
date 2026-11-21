import type { GameModule } from '@/core/engine/types';
import { META } from '../meta';
import {
  mafiaAction,
  mafiaConfig,
  pendingMafia,
  reduceMafia,
  resultMafia,
  setupMafia,
  validateMafia,
  viewMafia,
  type MafiaAction,
  type MafiaConfig,
  type MafiaKind,
  type MafiaState,
  type MafiaView,
} from './core';
import { MafiaPlay, makeMafiaSetup } from './ui';

function make(
  kind: MafiaKind,
  id: keyof typeof META,
  defaults: Partial<MafiaConfig> = {},
): GameModule<MafiaConfig, MafiaState, MafiaAction, MafiaView> {
  return {
    id,
    family: 'social-deduction',
    meta: META[id],
    configSchema: mafiaConfig,
    actionSchema: mafiaAction,
    defaultConfig: mafiaConfig.parse(defaults),
    setup: (players, cfg, rng, opts) => setupMafia(kind, players, cfg, rng, opts),
    reduce: reduceMafia,
    viewFor: viewMafia,
    result: resultMafia,
    pending: pendingMafia,
    deadline: (s) => (s.phase === 'day' || s.phase === 'defense' ? s.endsAt : null),
    validate: (cfg, n) => {
      const meta = META[id];
      if (n < meta.minPlayers) return { k: 'err.minPlayers', p: { n: meta.minPlayers } };
      if (n > meta.maxPlayers) return { k: 'err.maxPlayers', p: { n: meta.maxPlayers } };
      return validateMafia(kind, cfg, n);
    },
    screens: { Setup: makeMafiaSetup(kind), Play: MafiaPlay },
  };
}

export const mafiaModerated = make('moderated', 'mafia.moderated');
export const mafiaAuto = make('auto', 'mafia.auto');
export const werewolf = make('werewolf', 'mafia.werewolf');
export const oneNight = make('onenight', 'mafia.onenight', { daySeconds: 600 });
