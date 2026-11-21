import type { GameResult, PlayerId } from '@/core/engine/types';
import { uniqueName } from '@/core/identity/identity';

/** Public lobby state. It is broadcast to everyone, so it must never contain secrets or device ids. */
export interface LobbyPlayer {
  id: PlayerId;
  name: string;
  connected: boolean;
  ready: boolean;
  joinedAt: number;
  lastSeen: number;
}

export interface LobbyState {
  code: string;
  /** increases on every host change (election/transfer) */
  epoch: number;
  hostId: PlayerId;
  locked: boolean;
  players: LobbyPlayer[];
  game: { id: string; config: unknown } | null;
  status: 'lobby' | 'playing';
  /** session scoreboard (kept until the lobby closes) */
  scores: Record<PlayerId, number>;
  /** session stats for «آمار جلسه»: wins and highlight counters per player */
  stats: Record<PlayerId, Record<string, number>>;
  round: number;
  result: GameResult | null;
  /** set when the game stopped because the host disappeared */
  notice: string | null;
}

export const RECONNECT_GRACE_MS = 60_000;

export function createLobby(code: string, host: { id: PlayerId; name: string }, now: number): LobbyState {
  return {
    code,
    epoch: 0,
    hostId: host.id,
    locked: false,
    players: [{ id: host.id, name: host.name, connected: true, ready: true, joinedAt: now, lastSeen: now }],
    game: null,
    status: 'lobby',
    scores: {},
    stats: {},
    round: 0,
    result: null,
    notice: null,
  };
}

export function addPlayer(l: LobbyState, id: PlayerId, rawName: string, now: number): LobbyState {
  const name = uniqueName(
    rawName,
    l.players.map((p) => p.name),
  );
  return {
    ...l,
    players: [...l.players, { id, name, connected: true, ready: false, joinedAt: now, lastSeen: now }],
  };
}

export function setConnected(l: LobbyState, id: PlayerId, connected: boolean, now: number): LobbyState {
  return {
    ...l,
    players: l.players.map((p) => (p.id === id ? { ...p, connected, lastSeen: now } : p)),
  };
}

export function removePlayer(l: LobbyState, id: PlayerId): LobbyState {
  return { ...l, players: l.players.filter((p) => p.id !== id) };
}

/** Lobby-only: drop players who have been offline longer than the grace period. */
export function sweep(l: LobbyState, now: number): LobbyState {
  if (l.status !== 'lobby') return l;
  const stale = l.players.filter(
    (p) => !p.connected && p.id !== l.hostId && now - p.lastSeen > RECONNECT_GRACE_MS,
  );
  if (stale.length === 0) return l;
  return { ...l, players: l.players.filter((p) => !stale.includes(p)) };
}

export function canStart(l: LobbyState): 'ok' | 'no-game' | 'not-ready' {
  if (!l.game) return 'no-game';
  const waiting = l.players.filter((p) => p.connected && p.id !== l.hostId && !p.ready);
  return waiting.length ? 'not-ready' : 'ok';
}

export function applyResult(l: LobbyState, r: GameResult): LobbyState {
  const scores = { ...l.scores };
  for (const [id, pts] of Object.entries(r.scores)) scores[id] = (scores[id] ?? 0) + pts;
  const stats: LobbyState['stats'] = JSON.parse(JSON.stringify(l.stats));
  const bump = (id: string, key: string) => {
    stats[id] ??= {};
    stats[id][key] = (stats[id][key] ?? 0) + 1;
  };
  for (const w of r.winners) bump(w, 'wins');
  for (const id of l.players.map((p) => p.id)) bump(id, 'played');
  for (const h of r.highlights ?? []) bump(h.playerId, h.key);
  return { ...l, scores, stats, result: r };
}

/**
 * Deterministic host election used when the host vanished: the k-th oldest connected player
 * (k grows every `grace` ms, in case the first candidate is gone too).
 */
export function electHost(
  l: LobbyState,
  elapsedMs: number,
  graceMs: number,
  isAlive: (id: PlayerId) => boolean = () => true,
): PlayerId | null {
  if (elapsedMs < graceMs) return null;
  const candidates = l.players
    .filter((p) => p.id !== l.hostId && p.connected && isAlive(p.id))
    .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  if (candidates.length === 0) return null;
  const k = Math.floor((elapsedMs - graceMs) / graceMs);
  return candidates[Math.min(k, candidates.length - 1)]!.id;
}

/** session awards for «آمار جلسه» */
export function sessionAwards(l: LobbyState): { key: string; playerId: PlayerId; value: number }[] {
  const awards: { key: string; playerId: PlayerId; value: number }[] = [];
  const top = (fn: (id: PlayerId) => number, key: string) => {
    let best: PlayerId | null = null;
    let val = 0;
    for (const p of l.players) {
      const v = fn(p.id);
      if (v > val) {
        val = v;
        best = p.id;
      }
    }
    if (best) awards.push({ key, playerId: best, value: val });
  };
  top((id) => l.scores[id] ?? 0, 'award.night');
  top((id) => l.stats[id]?.['spy-win'] ?? 0, 'award.spy');
  top((id) => l.stats[id]?.['mafia-win'] ?? 0, 'award.mafia');
  top((id) => l.stats[id]?.['mvp'] ?? 0, 'award.mvp');
  top((id) => l.stats[id]?.['wins'] ?? 0, 'award.wins');
  return awards;
}
