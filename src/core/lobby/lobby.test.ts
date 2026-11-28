import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalHub, LocalTransport } from '@/core/net/local';
import { CODE_RE, makeRoomCode, normalizeCode } from '@/core/net/protocol';
import { loadGame } from '@/games/registry';
import type { HWState, HWView } from '@/games/hidden-word/core';
import { GameRunner } from '@/core/engine/runner';
import { ClientSession, HOST_GRACE_MS, transportLink, type ClientState, type Promotion } from './client';
import { HostSession, type HostSnapshot } from './host';
import { electHost, sessionAwards, sweep, type LobbyState } from './lobby';

let clock = 1_000_000;
const now = () => clock;

async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i++) await vi.advanceTimersByTimeAsync(0);
}

interface Phone {
  name: string;
  deviceId: string;
  t: LocalTransport;
  c: ClientSession;
  promoted: Promotion[];
}

function setup(hostName = 'میزبان') {
  const hub = new LocalHub();
  const code = 'K7QM';
  const saved: HostSnapshot[] = [];
  const stepDowns: string[] = [];
  const deps = (t: LocalTransport) => ({
    transport: t,
    now,
    loadGame,
    seed: () => 1234,
    persist: (s: HostSnapshot) => saved.push(s),
    onStepDown: (r: string) => stepDowns.push(r),
    tickMs: 100,
  });
  const hostT = new LocalTransport(hub);
  const host = HostSession.create(code, { name: hostName, deviceId: 'device-host-0001' }, deps(hostT));
  const hostState: { s: ClientState | null } = { s: null };
  const hostClient = new ClientSession(host.localLink({ name: hostName, deviceId: 'device-host-0001' }), {
    hello: { name: hostName, deviceId: 'device-host-0001' },
    onChange: (s) => (hostState.s = s),
    localNow: now,
  });
  const phones: Phone[] = [];
  const join = (name: string, deviceId = `device-${name}-${phones.length}-xxxx`) => {
    const t = new LocalTransport(hub);
    const promoted: Promotion[] = [];
    const hello = { name, deviceId };
    const phone: Phone = {
      name,
      deviceId,
      t,
      promoted,
      c: new ClientSession(transportLink(t, code, hello), {
        hello,
        onChange: () => undefined,
        onPromote: (p) => promoted.push(p),
        localNow: now,
        graceMs: 1000,
      }),
    };
    phones.push(phone);
    return phone;
  };
  return { hub, code, host, hostT, hostClient, hostState, join, phones, saved, stepDowns, deps };
}

beforeAll(async () => {
  await loadGame('spy.classic'); // warm the lazy chunk so host actions resolve in microtasks
});

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
});
afterEach(() => vi.useRealTimers());

describe('room codes', () => {
  it('are 4 chars without look-alikes', () => {
    for (let i = 0; i < 200; i++) {
      const c = makeRoomCode();
      expect(c).toMatch(CODE_RE);
      expect(c).not.toMatch(/[01OIL]/);
    }
    expect(normalizeCode(' k7qm ')).toBe('K7QM');
    expect(normalizeCode('۲۳ab')).toBe('23AB');
  });
});

describe('online lobby (host-authoritative over LocalTransport)', () => {
  it('players join, get unique names and a live list', async () => {
    const env = setup();
    await env.host.start();
    const a = env.join('علی');
    const b = env.join('علی');
    await flush();
    expect(a.c.state.status).toBe('online');
    expect(a.c.state.playerId).toBe('p2');
    const names = env.host.lobby.players.map((p) => p.name);
    expect(names).toEqual(['میزبان', 'علی', 'علی ۲']);
    expect(b.c.state.lobby?.players).toHaveLength(3);
    expect(env.hostState.s?.playerId).toBe('p1');
    // the public lobby never contains device ids
    expect(JSON.stringify(b.c.state.lobby)).not.toContain('device-');
  });

  it('ready → select → start; every phone only receives its own secrets', async () => {
    const env = setup();
    await env.host.start();
    const phones = ['رضا', 'سارا', 'مینا'].map((n) => env.join(n));
    await flush();
    env.hostClient.lobbyAction({ type: 'select', gameId: 'spy.classic', config: null });
    await flush();
    env.hostClient.lobbyAction({ type: 'start' });
    await flush();
    expect(env.host.lobby.status).toBe('lobby'); // not everyone is ready
    expect(env.hostState.s?.lastError).toBe('not-ready');
    for (const p of phones) p.c.lobbyAction({ type: 'ready', ready: true });
    await flush();
    env.hostClient.lobbyAction({ type: 'start' });
    await flush();
    expect(env.host.lobby.status).toBe('playing');
    const state = env.host.runner!.state as HWState;
    const spyId = Object.entries(state.assign).find(([, a]) => a.roleId === 'spy')![0];

    for (const p of phones) {
      const v = p.c.state.view as HWView;
      expect(v.me).not.toBeNull();
      if (p.c.state.playerId === spyId) expect(v.me!.word).toBeNull();
      else expect(v.me!.word).toBe(state.secret);
    }
    // secrecy at the wire level: inspect every frame each peer received
    const spyPhone = phones.find((p) => p.c.state.playerId === spyId);
    for (const entry of env.hub.log) {
      const frame = entry.data as { $: string; d?: { t?: string; view?: HWView } };
      if (frame.$ !== 'm' || frame.d?.t !== 'view') continue;
      const v = frame.d.view!;
      // views are only ever sent point-to-point (toPeer), never broadcast to the room
      const sameFrameToOthers = env.hub.log.filter((e) => e.data === entry.data);
      expect(sameFrameToOthers).toHaveLength(1);
      // nobody's view contains another player's role
      expect(JSON.stringify(v)).not.toContain('"roleId"');
      if (spyPhone && entry.to === spyPhone.t.selfId) {
        expect(JSON.stringify({ ...v, reference: null })).not.toContain(state.secret);
      }
    }
    // lobby broadcasts never contain the secret
    for (const entry of env.hub.log) {
      const frame = entry.data as { $: string; d?: { t?: string } };
      if (frame.d?.t === 'lobby') expect(JSON.stringify(frame)).not.toContain(state.secret);
    }
  });

  it('actions flow client → host → views; results go to the session scoreboard', async () => {
    const env = setup();
    await env.host.start();
    const phones = ['a1', 'b2', 'c3'].map((n) => env.join(n));
    await flush();
    for (const p of phones) p.c.lobbyAction({ type: 'ready', ready: true });
    env.hostClient.lobbyAction({ type: 'select', gameId: 'spy.classic', config: { voteMode: 'host' } });
    await flush();
    env.hostClient.lobbyAction({ type: 'start' });
    await flush();
    for (const c of [env.hostClient, ...phones.map((p) => p.c)]) c.gameAction({ type: 'ack' });
    await flush();
    expect((phones[0]!.c.state.view as HWView).phase).toBe('discuss');
    // a non-host cannot start the vote
    phones[0]!.c.gameAction({ type: 'startVote' });
    await flush();
    expect((phones[0]!.c.state.view as HWView).phase).toBe('discuss');
    env.hostClient.gameAction({ type: 'startVote' });
    await flush();
    const state = env.host.runner!.state as HWState;
    const citizen = Object.entries(state.assign).find(([, a]) => a.roleId === 'citizen')![0];
    env.hostClient.gameAction({ type: 'hostEliminate', target: citizen });
    await flush();
    expect(env.host.lobby.result?.title.k).toBe('hw.result.spies');
    const spy = Object.entries(state.assign).find(([, a]) => a.roleId === 'spy')![0];
    expect(phones[0]!.c.state.lobby?.scores[spy]).toBe(2);
    expect(phones[0]!.c.state.lobby?.stats[spy]?.['spy-win']).toBe(1);
    // next round keeps scores
    env.hostClient.lobbyAction({ type: 'next' });
    await flush();
    expect(env.host.lobby.round).toBe(2);
    expect(env.host.lobby.scores[spy]).toBe(2);
    env.hostClient.lobbyAction({ type: 'toLobby' });
    await flush();
    expect(phones[1]!.c.state.lobby?.status).toBe('lobby');
    expect(phones[1]!.c.state.view).toBeNull();
  });

  it('host timers fire from the host clock (endsAt)', async () => {
    const env = setup();
    await env.host.start();
    const phones = ['a1', 'b2', 'c3'].map((n) => env.join(n));
    await flush();
    for (const p of phones) p.c.lobbyAction({ type: 'ready', ready: true });
    env.hostClient.lobbyAction({ type: 'select', gameId: 'spy.classic', config: { roundSeconds: 60 } });
    await flush();
    env.hostClient.lobbyAction({ type: 'start' });
    await flush();
    for (const c of [env.hostClient, ...phones.map((p) => p.c)]) c.gameAction({ type: 'ack' });
    await flush();
    const v = phones[0]!.c.state.view as HWView;
    expect(v.endsAt).toBe(clock + 60_000);
    clock += 60_000;
    await vi.advanceTimersByTimeAsync(200);
    await flush();
    expect((phones[0]!.c.state.view as HWView).phase).toBe('vote');
  });

  it('kick bans the device; lock keeps strangers out but lets known players back in', async () => {
    const env = setup();
    await env.host.start();
    const a = env.join('a1');
    const b = env.join('b2');
    await flush();
    env.hostClient.lobbyAction({ type: 'kick', id: a.c.state.playerId! });
    await flush();
    expect(a.c.state.status).toBe('kicked');
    expect(env.host.lobby.players.map((p) => p.name)).toEqual(['میزبان', 'b2']);
    // the kicked device cannot come back
    const again = env.join('a1', a.deviceId);
    await flush();
    expect(again.c.state.status).toBe('kicked');
    // non-host cannot kick
    b.c.lobbyAction({ type: 'kick', id: 'p1' });
    await flush();
    expect(b.c.state.lastError).toBe('not-host');

    env.hostClient.lobbyAction({ type: 'lock', locked: true });
    await flush();
    const stranger = env.join('c3');
    await flush();
    expect(stranger.c.state.status).toBe('locked');
    // b drops and returns with the same device id → same seat
    const seat = b.c.state.playerId;
    env.hub.drop(b.t.selfId!);
    await flush();
    expect(env.host.lobby.players.find((p) => p.id === seat)?.connected).toBe(false);
    const back = env.join('b2', b.deviceId);
    await flush();
    expect(back.c.state.playerId).toBe(seat);
    expect(back.c.state.status).toBe('online');
  });

  it('reconnect mid-game keeps the seat and resends the private view', async () => {
    const env = setup();
    await env.host.start();
    const phones = ['a1', 'b2', 'c3'].map((n) => env.join(n));
    await flush();
    for (const p of phones) p.c.lobbyAction({ type: 'ready', ready: true });
    env.hostClient.lobbyAction({ type: 'select', gameId: 'spy.classic', config: null });
    await flush();
    env.hostClient.lobbyAction({ type: 'start' });
    await flush();
    const victim = phones[1]!;
    const before = victim.c.state.view as HWView;
    env.hub.drop(victim.t.selfId!);
    await flush();
    clock += 30_000; // within the 60s grace
    const back = env.join('b2', victim.deviceId);
    await flush();
    expect(back.c.state.playerId).toBe(victim.c.state.playerId);
    expect((back.c.state.view as HWView).me).toEqual(before.me);
    // a stranger cannot join while a game is running
    const late = env.join('late');
    await flush();
    expect(late.c.state.status).toBe('in-game');
  });

  it('players offline for more than 60s are removed from the lobby (not mid-game)', () => {
    const l: LobbyState = {
      code: 'AAAA',
      epoch: 0,
      hostId: 'p1',
      locked: false,
      status: 'lobby',
      game: null,
      scores: {},
      stats: {},
      round: 0,
      result: null,
      notice: null,
      players: [
        { id: 'p1', name: 'h', connected: true, ready: true, joinedAt: 0, lastSeen: 0 },
        { id: 'p2', name: 'x', connected: false, ready: false, joinedAt: 1, lastSeen: 0 },
      ],
    };
    expect(sweep(l, 59_000).players).toHaveLength(2);
    expect(sweep(l, 61_000).players).toHaveLength(1);
    expect(sweep({ ...l, status: 'playing' }, 61_000).players).toHaveLength(2);
  });

  it('host refresh: state is restored from the snapshot and phones reconnect', async () => {
    const env = setup();
    await env.host.start();
    const phones = ['a1', 'b2', 'c3'].map((n) => env.join(n));
    await flush();
    for (const p of phones) p.c.lobbyAction({ type: 'ready', ready: true });
    env.hostClient.lobbyAction({ type: 'select', gameId: 'spy.classic', config: null });
    await flush();
    env.hostClient.lobbyAction({ type: 'start' });
    await flush();
    const secret = (env.host.runner!.state as HWState).secret;
    const snap = env.saved.at(-1)!;
    // simulate a refresh: the old host disappears, a new process restores the snapshot
    env.host.stop();
    env.hostT.leave();
    await flush();
    expect(phones[0]!.c.state.status).toBe('host-lost');
    const t2 = new LocalTransport(env.hub);
    const host2 = await HostSession.restore(snap, env.deps(t2));
    await host2.start();
    await flush(10);
    expect(phones[0]!.c.state.status).toBe('online');
    expect((host2.runner!.state as HWState).secret).toBe(secret);
    expect(host2.lobby.players.filter((p) => p.connected)).toHaveLength(4); // host + 3 phones
    expect((phones[2]!.c.state.view as HWView).me).not.toBeNull();
  });

  it('host transfer hands a full snapshot to the chosen player only', async () => {
    const env = setup();
    await env.host.start();
    const phones = ['a1', 'b2', 'c3'].map((n) => env.join(n));
    await flush();
    for (const p of phones) p.c.lobbyAction({ type: 'ready', ready: true });
    env.hostClient.lobbyAction({ type: 'select', gameId: 'spy.classic', config: null });
    await flush();
    env.hostClient.lobbyAction({ type: 'start' });
    await flush();
    const target = phones[0]!;
    env.hostClient.lobbyAction({ type: 'transfer', id: target.c.state.playerId! });
    await flush();
    expect(env.stepDowns).toEqual(['transfer']);
    expect(target.promoted).toHaveLength(1);
    expect(phones[1]!.promoted).toHaveLength(0);
    const p = target.promoted[0]!;
    expect(p.kind).toBe('snapshot');
    const snap = (p as { data: HostSnapshot }).data;
    expect(snap.lobby.hostId).toBe(target.c.state.playerId);
    expect(snap.lobby.epoch).toBe(1);
    // the new host takes over in the same room with a higher epoch
    env.hostT.leave();
    target.c.close();
    const t2 = new LocalTransport(env.hub);
    const host2 = await HostSession.restore(snap, env.deps(t2));
    await host2.start();
    await flush(10);
    expect(phones[1]!.c.state.status).toBe('online');
    expect(host2.runner).not.toBeNull();
    expect((phones[1]!.c.state.view as HWView).me).not.toBeNull();
  });

  it('election: when the host vanishes the oldest player becomes host and seats are reclaimed', async () => {
    const env = setup();
    await env.host.start();
    const phones = ['a1', 'b2', 'c3'].map((n) => env.join(n));
    await flush();
    env.host.stop();
    env.hostT.leave();
    await flush();
    for (const p of phones) expect(p.c.state.status).toBe('host-lost');
    clock += 1100;
    for (const p of phones) p.c.checkElection(1000);
    expect(phones[0]!.promoted.map((x) => x.kind)).toEqual(['election']);
    expect(phones[1]!.promoted).toHaveLength(0);
    const prev = (phones[0]!.promoted[0] as { lobby: LobbyState }).lobby;
    phones[0]!.c.close();
    const t2 = new LocalTransport(env.hub);
    const host2 = HostSession.fromLobby(
      prev,
      { id: phones[0]!.c.state.playerId!, deviceId: phones[0]!.deviceId },
      env.deps(t2),
    );
    await host2.start();
    await flush(10);
    expect(host2.lobby.epoch).toBe(1);
    expect(phones[1]!.c.state.status).toBe('online');
    expect(phones[1]!.c.state.playerId).toBe('p3'); // same seat as before
    expect(phones[2]!.c.state.playerId).toBe('p4');
    expect(host2.lobby.players.map((p) => p.name)).toEqual(['میزبان', 'a1', 'b2', 'c3']);
  });

  async function startSpy(env: ReturnType<typeof setup>) {
    await env.host.start();
    const phones = ['a1', 'b2', 'c3'].map((n) => env.join(n));
    await flush();
    for (const p of phones) p.c.lobbyAction({ type: 'ready', ready: true });
    env.hostClient.lobbyAction({ type: 'select', gameId: 'spy.classic', config: null });
    await flush();
    env.hostClient.lobbyAction({ type: 'start' });
    await flush();
    return phones;
  }

  it('host drops briefly: nobody is elected, the game waits and continues when the host is back', async () => {
    const env = setup();
    const phones = await startSpy(env);
    // a long game: the phones have seen many view revisions
    const internals = env.host as unknown as { rev: number; pushViews(): void };
    internals.rev = 50;
    internals.pushViews();
    await flush();
    expect(phones[1]!.c.state.rev).toBe(50);
    const secret = (env.host.runner!.state as HWState).secret;
    const snap = env.saved.at(-1)!;
    env.host.stop();
    env.hostT.leave(); // e.g. the phone locked its screen and the page reloaded
    await flush();
    expect(phones[0]!.c.state.status).toBe('host-lost');
    const staleView = phones[1]!.c.state.view;
    // a minute later: still waiting for the same host, nobody has taken over
    clock += 60_000;
    for (const p of phones) p.c.checkElection(HOST_GRACE_MS);
    expect(phones.flatMap((p) => p.promoted)).toEqual([]);
    clock -= 60_000; // (keep the game's own timers out of this test)
    expect(phones[1]!.c.state.lobby!.status).toBe('playing');
    expect((phones[1]!.c.state.view as HWView).me).not.toBeNull(); // the game stays on screen
    const t2 = new LocalTransport(env.hub);
    const back = await HostSession.restore(snap, env.deps(t2));
    await back.start();
    await flush(10);
    for (const p of phones) expect(p.c.state.status).toBe('online');
    expect(back.lobby.hostId).toBe('p1');
    // the restarted host counts view revisions from 0 again: phones must still take its views
    expect(phones[1]!.c.state.view).not.toBe(staleView);
    expect(phones[1]!.c.state.view).toEqual(staleView);
    expect(back.lobby.status).toBe('playing');
    expect((back.runner!.state as HWState).secret).toBe(secret);
    // only if the host never comes back is a new one chosen
    expect(HOST_GRACE_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('host leaves mid-game: the next player takes over the room and the running game at once', async () => {
    const env = setup();
    const phones = await startSpy(env);
    const secret = (env.host.runner!.state as HWState).secret;
    expect(env.host.successor()).toBe('p2');
    const left = env.host.handOver();
    await flush();
    const heir = phones[0]!;
    expect(heir.promoted.map((p) => p.kind)).toEqual(['snapshot']);
    expect(phones[1]!.promoted).toHaveLength(0);
    const snap = (heir.promoted[0] as { data: HostSnapshot }).data;
    expect(snap.lobby).toMatchObject({ hostId: 'p2', epoch: 1, status: 'playing', notice: 'hostHandedOver' });
    expect(snap.lobby.players.find((p) => p.id === 'p1')!.connected).toBe(false);
    expect(Object.values(snap.devices)).not.toContain('p1');
    // the heir becomes the host (what the app does on a snapshot promotion)
    heir.c.close();
    const t2 = new LocalTransport(env.hub);
    const host2 = await HostSession.restore(snap, env.deps(t2));
    await host2.start();
    await flush(10);
    await expect(left).resolves.toBe(true); // the old host saw the new one and stopped
    expect(env.stepDowns).toEqual([]); // …without rejoining as a player
    expect(host2.runner!.hostId).toBe('p2');
    const st = host2.runner!.state as HWState;
    expect(st.secret).toBe(secret);
    expect((st as unknown as { hostId: string }).hostId).toBe('p2'); // host-only buttons work for the heir
    for (const p of phones.slice(1)) {
      expect(p.c.state.status).toBe('online');
      expect(p.c.state.lobby!.hostId).toBe('p2');
      expect((p.c.state.view as HWView).me).not.toBeNull();
    }
  });

  it('host leaves the lobby: removed from the list, the next player is the host', async () => {
    const env = setup();
    await env.host.start();
    const phones = ['a1', 'b2'].map((n) => env.join(n));
    await flush();
    void env.host.handOver();
    await flush();
    const snap = (phones[0]!.promoted[0] as { data: HostSnapshot }).data;
    expect(snap.lobby.hostId).toBe('p2');
    expect(snap.lobby.notice).toBe('hostLeft');
    expect(snap.lobby.players.map((p) => p.id)).toEqual(['p2', 'p3']);
  });

  it('host leaves with nobody else online: nothing to hand over', async () => {
    const env = setup();
    await env.host.start();
    await expect(env.host.handOver()).resolves.toBe(false);
  });

  it('runner hand-over moves host powers; moderated mafia stops (the moderator saw every role)', async () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((id) => ({ id, name: id }));
    const spyMod = await loadGame('spy.classic');
    const spy = GameRunner.create(spyMod, players.slice(0, 4), spyMod.defaultConfig, {
      seed: 1,
      now: 0,
      hostId: 'p1',
      local: false,
    });
    expect((spy.handOver('p3', { now: 0, leaving: true })!.state as { hostId: string }).hostId).toBe('p3');
    expect((spy.state as { hostId: string }).hostId).toBe('p1'); // the original is untouched
    const mod = await loadGame('mafia.moderated');
    const moderated = GameRunner.create(mod, players, mod.defaultConfig, {
      seed: 1,
      now: 0,
      hostId: 'p1',
      local: false,
    });
    expect(moderated.handOver('p2', { now: 0, leaving: true })).toBeNull();
    const auto = await loadGame('mafia.auto');
    const a = GameRunner.create(auto, players, auto.defaultConfig, {
      seed: 1,
      now: 0,
      hostId: 'p1',
      local: false,
    });
    expect((a.handOver('p2', { now: 0, leaving: true })!.state as { hostId: string }).hostId).toBe('p2');
  });

  it('a stale host steps down when it hears a newer epoch', async () => {
    const env = setup();
    await env.host.start();
    const t2 = new LocalTransport(env.hub);
    const newer = HostSession.fromLobby(
      env.host.lobby,
      { id: 'p9', deviceId: 'device-new-host' },
      env.deps(t2),
    );
    await newer.start();
    await flush(10);
    expect(env.stepDowns).toContain('superseded');
  });

  it('electHost is deterministic and skips missing candidates over time', () => {
    const l = {
      hostId: 'p1',
      players: [
        { id: 'p1', joinedAt: 0, connected: true },
        { id: 'p3', joinedAt: 5, connected: true },
        { id: 'p2', joinedAt: 2, connected: true },
        { id: 'p4', joinedAt: 9, connected: false },
      ],
    } as unknown as LobbyState;
    expect(electHost(l, 500, 1000)).toBeNull();
    expect(electHost(l, 1000, 1000)).toBe('p2');
    expect(electHost(l, 2100, 1000)).toBe('p3');
    expect(electHost(l, 9000, 1000)).toBe('p3');
  });

  it('session awards', () => {
    const l = {
      players: [{ id: 'a' }, { id: 'b' }],
      scores: { a: 3, b: 5 },
      stats: { a: { 'spy-win': 2 } },
    } as unknown as LobbyState;
    const awards = sessionAwards(l);
    expect(awards).toContainEqual({ key: 'award.night', playerId: 'b', value: 5 });
    expect(awards).toContainEqual({ key: 'award.spy', playerId: 'a', value: 2 });
  });
});
