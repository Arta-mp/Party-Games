import { describe, expect, it } from 'vitest';
import { abilityRoleSchema } from '@/custom/schemas';
import { Driver, expectNoLeak, makePlayers } from '@/test/harness';
import { roleOf, SKIP, type MafiaState, type MafiaView } from './core';
import { mafiaAuto, mafiaModerated, oneNight, werewolf } from './modes';
import {
  balance,
  checkComposition,
  defaultComposition,
  MAFIA_ROLES as R,
  ONE_NIGHT_ROLES,
  WEREWOLF_ROLES as W,
  type Composition,
} from './roles';

const comp = (...xs: [keyof typeof R, number][]): Composition => xs.map(([id, n]) => ({ role: R[id], n }));
const who = (d: Driver, roleId: string) =>
  Object.entries((d.state as MafiaState).assign)
    .filter(([, r]) => r === roleId)
    .map(([p]) => p);
const one = (d: Driver, roleId: string) => who(d, roleId)[0]!;
const S = (d: Driver) => d.state as MafiaState;

function ackAll(d: Driver) {
  for (const p of Object.keys(S(d).assign)) d.act(p, { type: 'ack' });
}
/** everyone sleeps except the given choices */
function night(d: Driver, choices: Record<string, { ability?: number; target: string | null }>) {
  for (const p of S(d).alive) {
    const c = choices[p];
    if (c) d.act(p, { type: 'night', ability: c.target ? (c.ability ?? 0) : -1, target: c.target });
  }
  for (const p of [...S(d).alive])
    if (S(d).phase === 'night' && !S(d).choices[p]) d.act(p, { type: 'night', ability: -1, target: null });
}
function voteOut(d: Driver, target: string | null) {
  d.act('p1', { type: 'startVote' });
  const voters = [...S(d).alive];
  for (const p of voters)
    if (S(d).phase === 'vote') d.act(p, { type: 'vote', target: target && p !== target ? target : SKIP });
}

describe('roles & composition (§7.3, §7.4)', () => {
  it('built-in roles are valid schema data; night may be one ability or a list', () => {
    expect(R.silencer.night).toHaveLength(2);
    expect(R.citizen.night).toEqual([]);
    const sniper = abilityRoleSchema.parse({
      id: 'sniper',
      nameFa: 'تک‌تیرانداز',
      team: 'citizens',
      night: { action: 'kill', target: 'other', uses: 1, priority: 40, fromNight: 2 },
      passive: ['appearsInnocent'],
      onWrongKill: 'selfDies',
    });
    expect(sniper.night[0]).toMatchObject({ action: 'kill', uses: 1, fromNight: 2 });
  });
  it('composition validation: mafia must be less than half', () => {
    expect(checkComposition(comp(['mafia', 3]), 6)).toBe('mafia.err.mafiaHalf');
    expect(checkComposition(comp(['doctor', 1]), 6)).toBe('mafia.err.noMafia');
    expect(checkComposition(comp(['mafia', 2], ['doctor', 6]), 6)).toBe('mafia.err.tooManyRoles');
    expect(checkComposition(comp(['mafia', 2], ['doctor', 1]), 6)).toBeNull();
    expect(mafiaAuto.validate!({ ...mafiaAuto.defaultConfig, composition: comp(['mafia', 3]) }, 6)?.k).toBe(
      'mafia.err.mafiaHalf',
    );
  });
  it('default compositions are valid for every player count', () => {
    for (let n = 5; n <= 16; n++) expect(checkComposition(defaultComposition('mafia', n), n)).toBeNull();
    for (let n = 6; n <= 20; n++) expect(checkComposition(defaultComposition('werewolf', n), n)).toBeNull();
    for (let n = 3; n <= 10; n++) expect(checkComposition(defaultComposition('onenight', n), n)).toBeNull();
  });
  it('balance indicator sums weights', () => {
    expect(balance(comp(['mafia', 1], ['doctor', 1], ['citizen', 2]))).toBe(-3 + 3 + 2);
  });
});

describe('mafia.auto (app is the moderator)', () => {
  const cfg = (c: Composition) => ({
    ...mafiaAuto.defaultConfig,
    composition: c,
    voteMode: 'secret' as const,
  });

  it('deals the composition; mafia know each other, citizens know nobody', () => {
    const d = new Driver(
      mafiaAuto,
      makePlayers(7),
      cfg(comp(['godfather', 1], ['mafia', 1], ['doctor', 1], ['detective', 1])),
    );
    expect(who(d, 'citizen')).toHaveLength(3);
    const gf = one(d, 'godfather');
    const m = one(d, 'mafia');
    expect((d.view(gf) as MafiaView).me?.teammates.map((t) => t.id)).toEqual([m]);
    const doc = one(d, 'doctor');
    expect((d.view(doc) as MafiaView).me?.teammates).toEqual([]);
    // nobody's view contains other roles before the end
    expectNoLeak(d.view(doc), ['پدرخوانده', 'مافیا ساده']);
    expectNoLeak(d.view('public'), ['پدرخوانده', 'دکتر', 'کارآگاه']);
  });

  it('night: mafia kill, doctor saves (protect 20 before kill 30), detective sees godfather as innocent', () => {
    const d = new Driver(
      mafiaAuto,
      makePlayers(7),
      cfg(comp(['godfather', 1], ['mafia', 1], ['doctor', 1], ['detective', 1])),
    );
    ackAll(d);
    expect(S(d).phase).toBe('night');
    expect(d.pending()).toHaveLength(7); // everyone takes the phone at night
    const [gf, m, doc, det] = [one(d, 'godfather'), one(d, 'mafia'), one(d, 'doctor'), one(d, 'detective')];
    const victim = who(d, 'citizen')[0]!;
    // teammates see each other's picks
    d.act(gf, { type: 'night', ability: 0, target: victim });
    expect((d.view(m) as MafiaView).me?.teamPicks).toEqual([{ id: gf, target: victim }]);
    expect(JSON.stringify(d.view(doc))).not.toContain(victim === doc ? '###' : `"target":"${victim}"`);
    night(d, { [m]: { target: victim }, [doc]: { target: victim }, [det]: { target: gf } });
    expect(S(d).phase).toBe('dawn');
    expect(S(d).alive).toContain(victim);
    expect(S(d).dawn?.saved).toBe(1);
    expect((d.view(det) as MafiaView).me?.notes.at(-1)?.k).toBe('mafia.note.innocent');
    // the detective's result is private
    expect(JSON.stringify(d.view(doc))).not.toContain('mafia.note.innocent');
  });

  it('kill succeeds without protection; dead players are revealed; day timer then vote', () => {
    const d = new Driver(mafiaAuto, makePlayers(6), cfg(comp(['mafia', 1], ['detective', 1])));
    ackAll(d);
    const m = one(d, 'mafia');
    const det = one(d, 'detective');
    const victim = who(d, 'citizen')[0]!;
    night(d, { [m]: { target: victim }, [det]: { target: m } });
    expect(S(d).alive).not.toContain(victim);
    expect((d.view(det) as MafiaView).me?.notes.at(-1)?.k).toBe('mafia.note.guilty');
    expect((d.view('public') as MafiaView).dawn?.killed).toEqual([{ id: victim, role: 'شهروند ساده' }]);
    d.act('p1', { type: 'continue' });
    expect(S(d).phase).toBe('day');
    d.advance(240_000);
    expect(S(d).phase).toBe('vote');
  });

  it('lynching the last mafia → citizens win; scores and highlights', () => {
    const d = new Driver(mafiaAuto, makePlayers(5), cfg(comp(['mafia', 1], ['doctor', 1])));
    ackAll(d);
    night(d, {});
    d.act('p1', { type: 'continue' });
    const m = one(d, 'mafia');
    voteOut(d, m);
    const r = d.result()!;
    expect(r.title.k).toBe('mafia.result.citizens');
    expect(r.winners).not.toContain(m);
    expect(r.winners).toHaveLength(4);
  });

  it('mafia wins when equal to the rest', () => {
    const d = new Driver(mafiaAuto, makePlayers(5), cfg(comp(['mafia', 2])));
    ackAll(d);
    const [m1, m2] = who(d, 'mafia');
    const cits = who(d, 'citizen');
    night(d, { [m1!]: { target: cits[0]! }, [m2!]: { target: cits[0]! } });
    // 2 mafia vs 2 citizens → mafia win
    expect(d.result()?.title.k).toBe('mafia.result.mafia');
    expect(d.result()?.highlights?.map((h) => h.key)).toEqual(['mafia-win', 'mafia-win']);
  });

  it('shared team kill uses the plurality of picks', () => {
    const d = new Driver(mafiaAuto, makePlayers(9), cfg(comp(['mafia', 3])));
    ackAll(d);
    const ms = who(d, 'mafia');
    const [a, b] = who(d, 'citizen');
    night(d, { [ms[0]!]: { target: a! }, [ms[1]!]: { target: b! }, [ms[2]!]: { target: b! } });
    expect(S(d).alive).toContain(a);
    expect(S(d).alive).not.toContain(b);
  });

  it('sniper: only from night 2, one bullet; shooting a citizen kills the sniper too', () => {
    const d = new Driver(mafiaAuto, makePlayers(8), cfg(comp(['mafia', 1], ['sniper', 1])));
    ackAll(d);
    const sn = one(d, 'sniper');
    expect((d.view(sn) as MafiaView).me?.abilities).toEqual([]);
    night(d, {});
    d.act('p1', { type: 'continue' });
    voteOut(d, null);
    expect(S(d).night).toBe(2);
    expect((d.view(sn) as MafiaView).me?.abilities).toHaveLength(1);
    const cit = who(d, 'citizen')[0]!;
    night(d, { [sn]: { target: cit } });
    expect(S(d).alive).not.toContain(cit);
    expect(S(d).alive).not.toContain(sn);
  });

  it('bulletproof survives the first kill only', () => {
    const d = new Driver(mafiaAuto, makePlayers(8), cfg(comp(['mafia', 1], ['bodyguard', 1])));
    ackAll(d);
    const m = one(d, 'mafia');
    const bg = one(d, 'bodyguard');
    night(d, { [m]: { target: bg } });
    expect(S(d).alive).toContain(bg);
    d.act('p1', { type: 'continue' });
    voteOut(d, null);
    night(d, { [m]: { target: bg } });
    expect(S(d).alive).not.toContain(bg);
  });

  it('silencer silences someone for the next day (only they and the table are told)', () => {
    const d = new Driver(mafiaAuto, makePlayers(10), cfg(comp(['silencer', 1], ['mafia', 1])));
    ackAll(d);
    const sil = one(d, 'silencer');
    const target = who(d, 'citizen')[0]!;
    night(d, { [sil]: { ability: 1, target } });
    d.act('p1', { type: 'continue' });
    expect((d.view(target) as MafiaView).me?.silenced).toBe(true);
    expect((d.view('public') as MafiaView).dawn?.silenced).toEqual([target]);
  });

  it('jester wins alone when lynched', () => {
    const d = new Driver(mafiaAuto, makePlayers(6), cfg(comp(['mafia', 1], ['jester', 1])));
    ackAll(d);
    night(d, {});
    d.act('p1', { type: 'continue' });
    const j = one(d, 'jester');
    voteOut(d, j);
    expect(d.result()?.winners).toEqual([j]);
    expect(d.result()?.title.k).toBe('mafia.result.solo');
  });

  it('tie or abstain → nobody is lynched', () => {
    const d = new Driver(mafiaAuto, makePlayers(6), cfg(comp(['mafia', 1])));
    ackAll(d);
    night(d, {});
    d.act('p1', { type: 'continue' });
    voteOut(d, null);
    expect(S(d).lastLynch?.id).toBeNull();
    expect(S(d).phase).toBe('night');
  });

  it('rejects invalid night actions (dead, wrong target, used up)', () => {
    const d = new Driver(mafiaAuto, makePlayers(6), cfg(comp(['mafia', 1], ['doctor', 1])));
    ackAll(d);
    const m = one(d, 'mafia');
    d.noop(m, { type: 'night', ability: 0, target: m }); // 'other' only
    d.noop(m, { type: 'night', ability: 2, target: 'p2' });
    d.noop(m, { type: 'night', ability: 0, target: 'ghost' });
  });

  it('host-overridable priorities change resolution order (kill before protect)', () => {
    const c = comp(['mafia', 1], ['doctor', 1]);
    const d = new Driver(mafiaAuto, makePlayers(6), { ...cfg(c), priorities: { mafia: 5 } });
    ackAll(d);
    const victim = who(d, 'citizen')[0]!;
    night(d, { [one(d, 'mafia')]: { target: victim }, [one(d, 'doctor')]: { target: victim } });
    expect(S(d).alive).not.toContain(victim);
  });

  it('custom data-only role (blocker) works without new code', () => {
    const blocker = abilityRoleSchema.parse({
      id: 'barman',
      nameFa: 'ساقی',
      team: 'citizens',
      night: { action: 'block', target: 'other' },
      weight: 2,
    });
    const d = new Driver(
      mafiaAuto,
      makePlayers(7),
      cfg([
        { role: R.mafia, n: 1 },
        { role: blocker, n: 1 },
      ]),
    );
    ackAll(d);
    const m = one(d, 'mafia');
    const victim = who(d, 'citizen')[0]!;
    night(d, { [m]: { target: victim }, [one(d, 'barman')]: { target: m } });
    expect(S(d).alive).toContain(victim);
    expect((d.view(m) as MafiaView).me?.notes.at(-1)?.k).toBe('mafia.note.blocked');
  });

  it('convert recruits a citizen into the mafia', () => {
    const recruiter = abilityRoleSchema.parse({
      id: 'recruiter',
      nameFa: 'جذب‌کننده',
      team: 'mafia',
      night: { action: 'convert', target: 'other', uses: 1 },
      knowsTeammates: true,
    });
    const d = new Driver(
      mafiaAuto,
      makePlayers(8),
      cfg([
        { role: R.mafia, n: 1 },
        { role: recruiter, n: 1 },
      ]),
    );
    ackAll(d);
    const target = who(d, 'citizen')[0]!;
    night(d, { [one(d, 'recruiter')]: { target } });
    expect(roleOf(S(d), target).team).toBe('mafia');
    expect((d.view(target) as MafiaView).me?.notes.at(-1)?.k).toBe('mafia.note.converted');
  });
});

describe('mafia.werewolf', () => {
  it('witch has two one-shot potions; hunter takes someone with him', () => {
    const c: Composition = [
      { role: W.werewolf, n: 1 },
      { role: W.witch, n: 1 },
      { role: W.hunter, n: 1 },
    ];
    const d = new Driver(werewolf, makePlayers(7), { ...werewolf.defaultConfig, composition: c });
    ackAll(d);
    const wolf = one(d, 'werewolf');
    const witch = one(d, 'witch');
    const hunter = one(d, 'hunter');
    expect((d.view(witch) as MafiaView).me?.abilities.map((a) => a.action)).toEqual(['protect', 'kill']);
    night(d, { [wolf]: { target: hunter } });
    expect(S(d).phase).toBe('revenge');
    expect(d.pending()).toEqual([hunter]);
    d.act(hunter, { type: 'revenge', target: wolf });
    expect(d.result()?.title.k).toBe('mafia.result.citizens');
  });
  it('witch heal is used up after one use', () => {
    const c: Composition = [
      { role: W.werewolf, n: 1 },
      { role: W.witch, n: 1 },
    ];
    const d = new Driver(werewolf, makePlayers(8), { ...werewolf.defaultConfig, composition: c });
    ackAll(d);
    const witch = one(d, 'witch');
    night(d, { [witch]: { ability: 0, target: witch } });
    d.act('p1', { type: 'continue' });
    voteOut(d, null);
    expect((d.view(witch) as MafiaView).me?.abilities.map((a) => a.action)).toEqual(['kill']);
  });
});

describe('mafia.onenight', () => {
  it('one night, swaps change teams, seer sees the exact role, single vote decides', () => {
    const c: Composition = [
      { role: ONE_NIGHT_ROLES.werewolf, n: 1 },
      { role: ONE_NIGHT_ROLES.seer, n: 1 },
      { role: ONE_NIGHT_ROLES.swapper, n: 1 },
    ];
    const d = new Driver(oneNight, makePlayers(5), { ...oneNight.defaultConfig, composition: c });
    ackAll(d);
    const wolf = one(d, 'werewolf');
    const seer = one(d, 'seer');
    const swapper = one(d, 'swapper');
    // werewolves have no night ability here, they just sleep
    expect((d.view(wolf) as MafiaView).me?.abilities).toEqual([]);
    night(d, { [seer]: { target: wolf }, [swapper]: { target: wolf } });
    // seer acted at priority 50 after the swap (25) → sees the *new* card of the wolf seat (swapper)
    expect((d.view(seer) as MafiaView).me?.notes.at(-1)).toMatchObject({
      k: 'mafia.note.sawRole',
      p: { role: 'جابه‌جاگر' },
    });
    expect(roleOf(S(d), swapper).id).toBe('werewolf');
    expect((d.view(swapper) as MafiaView).me?.notes.at(-1)?.k).toBe('mafia.note.swapped');
    d.act('p1', { type: 'continue' });
    voteOut(d, swapper); // the swapper now holds the wolf card
    expect(d.result()?.title.k).toBe('mafia.result.citizens');
    expect(d.result()?.winners).toContain(wolf); // original wolf is now a citizen-team swapper
  });
});

describe('mafia.moderated', () => {
  it('moderator gets no role but sees the full script; players only their own role', () => {
    const d = new Driver(mafiaModerated, makePlayers(7), {
      ...mafiaModerated.defaultConfig,
      composition: comp(['godfather', 1], ['mafia', 1], ['doctor', 1]),
    });
    expect(S(d).assign.p1).toBeUndefined(); // host = moderator
    ackAll(d);
    expect(S(d).phase).toBe('moderating');
    const v = d.view('p1') as MafiaView;
    expect(v.script?.roles).toHaveLength(6);
    // the mafia wake up first (shared kill 30), then the doctor? → doctor protect is 20 → doctor first
    expect(v.script?.order.map((s) => s.action)).toEqual(['protect', 'kill']);
    expect((d.view('p2') as MafiaView).script).toBeNull();
    d.noop('p2', { type: 'modEnd', team: 'mafia' });
    d.act('p1', { type: 'modToggle', target: 'p2' });
    expect(S(d).alive).not.toContain('p2');
    d.act('p1', { type: 'modEnd', team: 'citizens' });
    expect(d.result()?.title.k).toBe('mafia.result.citizens');
  });
});
