import { create } from 'zustand';
import type { AnyGameModule } from '@/core/engine/types';
import { useIdentity } from '@/core/identity/store';
import { ClientSession, transportLink, type ClientState, type Promotion } from '@/core/lobby/client';
import { HostSession, type HostDeps, type HostSnapshot } from '@/core/lobby/host';
import type { LobbyState } from '@/core/lobby/lobby';
import { createTransport } from '@/core/net/factory';
import { makeRoomCode, type Hello, type LobbyAction } from '@/core/net/protocol';
import type { Transport } from '@/core/net/transport';
import { loadGame } from '@/games/registry';
import { readJSON, removeKey, writeJSON } from '@/lib/storage';
import { useSettings } from './settings';

/** App-level online session: one ClientSession (the host uses a loopback one) + optional HostSession. */
interface OnlineStore {
  code: string | null;
  role: 'host' | 'client' | null;
  state: ClientState | null;
  module: AnyGameModule | null;
  transportKind: string | null;
  createLobby(): Promise<string>;
  join(code: string): void;
  /** after a refresh: resume hosting from the snapshot, or re-join as client */
  resume(code: string): Promise<void>;
  leave(): void;
  lobbyAction(a: LobbyAction): void;
  gameAction(a: unknown): void;
  now(): number;
}

const SESSION_KEY = 'pg:session';
const hostKey = (code: string) => `pg:host:${code}`;
const SNAPSHOT_TTL = 3 * 60 * 60 * 1000;

let host: HostSession | null = null;
let client: ClientSession | null = null;
let transport: Transport | null = null;
let moduleFor: string | null = null;

function hello(): Hello {
  const id = useIdentity.getState();
  return { name: id.name ?? 'مهمان', deviceId: id.deviceId };
}

export const useOnline = create<OnlineStore>((set, get) => {
  const onChange = (s: ClientState) => {
    set({ state: s });
    if (s.gameId && s.gameId !== moduleFor) {
      moduleFor = s.gameId;
      void loadGame(s.gameId).then((m) => moduleFor === m.id && set({ module: m }));
    }
    if (!s.gameId && get().module) {
      moduleFor = null;
      set({ module: null });
    }
  };

  const deps = (code: string): HostDeps => ({
    transport: transport!,
    now: Date.now,
    loadGame,
    persist: (snap) => writeJSON(hostKey(code), snap),
    onStepDown: () => {
      // transfer done or a newer host exists: continue as a normal player of the same room
      host?.stop();
      host = null;
      client?.close();
      client = null;
      transport?.leave();
      removeKey(hostKey(code));
      startClient(code);
    },
  });

  const startLoopback = (code: string, h: HostSession) => {
    host = h;
    const hi = hello();
    client = new ClientSession(h.localLink(hi), { hello: hi, onChange });
    set({ code, role: 'host', transportKind: transport?.kind ?? null });
    writeJSON(SESSION_KEY, { code, role: 'host' });
  };

  const onPromote = async (p: Promotion) => {
    const code = get().code!;
    client?.close();
    client = null;
    transport = createTransport(useSettings.getState());
    const h =
      p.kind === 'snapshot'
        ? await HostSession.restore(p.data, deps(code))
        : HostSession.fromLobby(
            p.lobby as LobbyState,
            { id: get().state!.playerId!, deviceId: hello().deviceId },
            deps(code),
          );
    await h.start();
    startLoopback(code, h);
  };

  const startClient = (code: string) => {
    transport = createTransport(useSettings.getState());
    const hi = hello();
    client = new ClientSession(transportLink(transport, code, hi), {
      hello: hi,
      onChange,
      onPromote: (p) => void onPromote(p),
    });
    set({ code, role: 'client', transportKind: transport.kind });
    writeJSON(SESSION_KEY, { code, role: 'client' });
  };

  const teardown = () => {
    host?.stop();
    host = null;
    client?.close();
    client = null;
    transport?.leave();
    transport = null;
    moduleFor = null;
  };

  return {
    code: null,
    role: null,
    state: null,
    module: null,
    transportKind: null,
    async createLobby() {
      teardown();
      const code = makeRoomCode();
      transport = createTransport(useSettings.getState());
      const h = HostSession.create(code, hello(), deps(code));
      startLoopback(code, h);
      await h.start();
      return code;
    },
    join(code) {
      if (get().code === code && client) return;
      teardown();
      set({ state: null, module: null });
      startClient(code);
    },
    async resume(code) {
      if (get().code === code && client) return;
      const saved = readJSON<{ code: string; role: string } | null>(SESSION_KEY, null);
      const snap = readJSON<HostSnapshot | null>(hostKey(code), null);
      if (saved?.code === code && saved.role === 'host' && snap && Date.now() - snap.savedAt < SNAPSHOT_TTL) {
        teardown();
        transport = createTransport(useSettings.getState());
        const h = await HostSession.restore(snap, deps(code));
        startLoopback(code, h);
        await h.start();
        return;
      }
      get().join(code);
    },
    leave() {
      const code = get().code;
      teardown();
      if (code) removeKey(hostKey(code));
      removeKey(SESSION_KEY);
      set({ code: null, role: null, state: null, module: null });
    },
    lobbyAction: (a) => client?.lobbyAction(a),
    gameAction: (a) => client?.gameAction(a),
    now: () => client?.now() ?? Date.now(),
  };
});
