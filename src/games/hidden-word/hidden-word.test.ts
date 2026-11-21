import { describe, expect, it } from 'vitest';
import { Driver, expectNoLeak, makePlayers } from '@/test/harness';
import { WITNESS, type HWState, type HWView } from './core';
import { insider, type InsiderState, type InsiderView } from './insider';
import { spyBlank, spyClassic, spyGrid, spyInfiltrator, spyMulti, spyRoles, spyTopic } from './modes';

const spiesOf = (s: HWState) =>
  Object.entries(s.assign)
    .filter(([, a]) => a.roleId === 'spy')
    .map(([id]) => id);
const citizensOf = (s: HWState) =>
  Object.entries(s.assign)
    .filter(([, a]) => a.roleId === 'citizen')
    .map(([id]) => id);

function ackAll(d: Driver) {
  for (const id of d.ids()) d.act(id, { type: 'ack' });
}

describe('spy.classic', () => {
  it('deals exactly one spy who does not see the location', () => {
    const d = new Driver(spyClassic, makePlayers(5));
    const s = d.state as HWState;
    expect(spiesOf(s)).toHaveLength(1);
    const spy = spiesOf(s)[0]!;
    const spyView = d.view(spy) as HWView;
    expect(spyView.me?.word).toBeNull();
    expect(spyView.me?.roleName).toBe('جاسوس');
    for (const c of citizensOf(s)) expect((d.view(c) as HWView).me?.word).toBe(s.secret);
  });

  it('is deterministic for a fixed seed', () => {
    const a = new Driver(spyClassic, makePlayers(6), undefined, { seed: 7 });
    const b = new Driver(spyClassic, makePlayers(6), undefined, { seed: 7 });
    const c = new Driver(spyClassic, makePlayers(6), undefined, { seed: 8 });
    expect(a.state).toEqual(b.state);
    expect(JSON.stringify(a.state)).not.toEqual(JSON.stringify(c.state));
  });

  it('never leaks the secret or other roles in views', () => {
    const d = new Driver(spyClassic, makePlayers(5));
    const s = d.state as HWState;
    const spy = spiesOf(s)[0]!;
    const spyView = d.view(spy) as HWView;
    // the reference list contains every location, so strip it before checking
    expectNoLeak({ ...spyView, reference: null }, [s.secret], 'spy view');
    for (const id of d.ids()) {
      const v = d.view(id) as HWView;
      expect(JSON.stringify(v)).not.toContain('"roleId"');
      expect(v.outcome).toBeNull();
    }
    expectNoLeak({ ...(d.view('public') as HWView), reference: null }, [s.secret], 'public view');
  });

  it('reveal → discuss with absolute endsAt; timer expiry starts the vote', () => {
    const d = new Driver(spyClassic, makePlayers(4));
    expect(d.pending()).toHaveLength(4);
    ackAll(d);
    const s = d.state as HWState;
    expect(s.phase).toBe('discuss');
    expect(s.endsAt).toBe(d.now + 300_000);
    expect(d.advance(299_000)).toBe(false);
    expect(d.advance(1_000)).toBe(true);
    expect((d.state as HWState).phase).toBe('vote');
  });

  it('caught spy guesses: correct → spies win', () => {
    const d = new Driver(spyClassic, makePlayers(4));
    ackAll(d);
    d.act('p1', { type: 'startVote' });
    const s = d.state as HWState;
    const spy = spiesOf(s)[0]!;
    for (const id of d.ids())
      d.act(id, { type: 'vote', target: id === spy ? d.ids().find((x) => x !== spy)! : spy });
    expect((d.state as HWState).phase).toBe('guess');
    expect(d.pending()).toEqual([spy]);
    expect((d.view(spy) as HWView).guess?.options).toContain(s.secret);
    expect((d.view(citizensOf(s)[0]!) as HWView).guess?.options).toBeNull();
    d.act(spy, { type: 'guess', answer: s.secret });
    const r = d.result()!;
    expect(r.title.k).toBe('hw.result.spies');
    expect(r.winners).toEqual([spy]);
    expect(r.scores[spy]).toBe(2);
    expect(r.highlights).toEqual([{ key: 'spy-win', playerId: spy }]);
  });

  it('caught spy guesses wrong → citizens win', () => {
    const d = new Driver(spyClassic, makePlayers(4));
    ackAll(d);
    d.act('p1', { type: 'startVote' });
    const s = d.state as HWState;
    const spy = spiesOf(s)[0]!;
    for (const id of d.ids())
      d.act(id, { type: 'vote', target: id === spy ? d.ids().find((x) => x !== spy)! : spy });
    d.act(spy, { type: 'guess', answer: 'جای اشتباه' });
    const r = d.result()!;
    expect(r.title.k).toBe('hw.result.citizens');
    expect(r.winners.sort()).toEqual(citizensOf(s).sort());
  });

  it('voting out a citizen → spies win', () => {
    const d = new Driver(spyClassic, makePlayers(4));
    ackAll(d);
    d.act('p1', { type: 'startVote' });
    const s = d.state as HWState;
    const victim = citizensOf(s)[0]!;
    for (const id of d.ids())
      d.act(id, { type: 'vote', target: id === victim ? d.ids().find((x) => x !== victim)! : victim });
    expect(d.result()!.title.k).toBe('hw.result.spies');
  });

  it('spy can declare a guess any time during discussion', () => {
    const d = new Driver(spyClassic, makePlayers(4));
    ackAll(d);
    const s = d.state as HWState;
    const spy = spiesOf(s)[0]!;
    const cit = citizensOf(s)[0]!;
    d.noop(cit, { type: 'declareGuess' });
    expect((d.view(spy) as HWView).me?.canDeclareGuess).toBe(true);
    expect((d.view(cit) as HWView).me?.canDeclareGuess).toBe(false);
    d.act(spy, { type: 'declareGuess' });
    d.act(spy, { type: 'guess', answer: 'غلط' });
    expect(d.result()!.title.k).toBe('hw.result.citizens');
  });

  it('a tie re-vote is only between the tied players', () => {
    const d = new Driver(spyClassic, makePlayers(5));
    ackAll(d);
    d.act('p1', { type: 'startVote' });
    // p1→p2, p2→p1, p3→p1, p4→p2, p5→p3  ⇒ p1:2, p2:2, p3:1 → tie between p1 and p2
    const votes: Record<string, string> = { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p2', p5: 'p3' };
    for (const [a, b] of Object.entries(votes)) d.act(a, { type: 'vote', target: b });
    expect((d.state as HWState).candidates?.sort()).toEqual(['p1', 'p2']);
    expect((d.view('p4') as HWView).candidates?.sort()).toEqual(['p1', 'p2']);
    d.noop('p4', { type: 'vote', target: 'p3' }); // p3 is not tied
    d.act('p4', { type: 'vote', target: 'p1' });
    d.act('p3', { type: 'vote', target: 'p1' });
    d.act('p5', { type: 'vote', target: 'p1' });
    d.act('p1', { type: 'vote', target: 'p2' });
    d.act('p2', { type: 'vote', target: 'p1' });
    expect((d.state as HWState).lastOut).toBe('p1');
    expect((d.state as HWState).candidates).toBeNull();
  });

  it('a tie forces a revote; a second tie lets the spy win', () => {
    const d = new Driver(spyClassic, makePlayers(4));
    ackAll(d);
    d.act('p1', { type: 'startVote' });
    // p1↔p2, p3↔p4 → 2-2 tie
    const pairs: Record<string, string> = { p1: 'p2', p2: 'p1', p3: 'p4', p4: 'p3' };
    for (const [a, b] of Object.entries(pairs)) d.act(a, { type: 'vote', target: b });
    expect((d.state as HWState).phase).toBe('vote');
    expect((d.state as HWState).notice?.k).toBe('hw.notice.tie');
    for (const [a, b] of Object.entries(pairs)) d.act(a, { type: 'vote', target: b });
    expect(d.result()!.title.k).toBe('hw.result.spies');
  });

  it('rejects invalid votes and non-host actions', () => {
    const d = new Driver(spyClassic, makePlayers(4));
    ackAll(d);
    d.noop('p2', { type: 'startVote' });
    d.act('p1', { type: 'startVote' });
    d.noop('p1', { type: 'vote', target: 'p1' });
    d.noop('p1', { type: 'vote', target: 'nobody' });
    expect(d.runner.dispatch({ type: 'vote' }, 'p1', d.now)).toEqual({ ok: false, error: 'bad-action' });
    expect(d.runner.dispatch({ type: 'ack' }, 'intruder', d.now)).toEqual({
      ok: false,
      error: 'not-a-player',
    });
  });

  it('host-recorded vote mode', () => {
    const d = new Driver(spyClassic, makePlayers(4), { ...spyClassic.defaultConfig, voteMode: 'host' });
    ackAll(d);
    d.act('p1', { type: 'startVote' });
    expect(d.pending()).toEqual([]);
    d.noop('p2', { type: 'hostEliminate', target: 'p3' });
    const spy = spiesOf(d.state as HWState)[0]!;
    d.act('p1', { type: 'hostEliminate', target: spy });
    expect((d.state as HWState).phase).toBe('guess');
  });

  it('pass & play lets the shared screen run host actions', () => {
    const d = new Driver(
      spyClassic,
      makePlayers(4),
      { ...spyClassic.defaultConfig, voteMode: 'host' },
      { local: true },
    );
    ackAll(d);
    d.act('p3', { type: 'startVote' });
    expect((d.state as HWState).phase).toBe('vote');
  });
});

describe('secret sources (locations + word categories)', () => {
  it('classic draws from every category by default; the spy sees the category', () => {
    const cats = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const d = new Driver(spyClassic, makePlayers(4), undefined, { seed });
      const s = d.state as HWState;
      const spy = spiesOf(s)[0]!;
      const v = d.view(spy) as HWView;
      expect(v.me?.word).toBeNull();
      expect(v.me?.category).toBeTruthy();
      expect(v.reference).toContain(s.secret);
      cats.add(v.me!.category!);
    }
    expect(cats.size).toBeGreaterThan(4);
    expect(cats.has('مکان')).toBe(true);
  });
  it('host can restrict sources and hide the category from the spy', () => {
    for (let seed = 0; seed < 10; seed++) {
      const d = new Driver(
        spyClassic,
        makePlayers(4),
        { ...spyClassic.defaultConfig, sources: ['حیوان'], spySeesCategory: false },
        { seed },
      );
      const s = d.state as HWState;
      const cit = d.view(citizensOf(s)[0]!) as HWView;
      expect(cit.me?.category).toBe('حیوان');
      const spy = d.view(spiesOf(s)[0]!) as HWView;
      expect(spy.me?.category).toBeNull();
      expect(spy.me?.roleName).toBe('جاسوس');
    }
  });
  it('many spies uses the same sources', () => {
    const d = new Driver(spyMulti, makePlayers(6), { ...spyMulti.defaultConfig, sources: ['غذا'] });
    expect((d.view(citizensOf(d.state as HWState)[0]!) as HWView).me?.category).toBe('غذا');
  });
});

describe('spy.roles', () => {
  it('gives each citizen a role from the location; spy gets none', () => {
    const d = new Driver(spyRoles, makePlayers(6));
    const s = d.state as HWState;
    for (const id of d.ids()) {
      const v = d.view(id) as HWView;
      if (spiesOf(s).includes(id)) expect(v.me?.subrole).toBeNull();
      else expect(v.me?.subrole).toBeTruthy();
    }
  });
});

describe('spy.multi', () => {
  it('with 6 players and 2 spies exactly 2 players do not see the location', () => {
    const d = new Driver(spyMulti, makePlayers(6), { ...spyMulti.defaultConfig, spyCount: 2 });
    const blind = d.ids().filter((id) => (d.view(id) as HWView).me?.word == null);
    expect(blind).toHaveLength(2);
  });
  it('spies know each other only when enabled', () => {
    const on = new Driver(spyMulti, makePlayers(7), {
      ...spyMulti.defaultConfig,
      spyCount: 3,
      spiesKnowEachOther: true,
    });
    const sOn = on.state as HWState;
    for (const spy of spiesOf(sOn))
      expect((on.view(spy) as HWView).me?.knows.map((k) => k.id).sort()).toEqual(
        spiesOf(sOn)
          .filter((x) => x !== spy)
          .sort(),
      );
    for (const c of citizensOf(sOn)) expect((on.view(c) as HWView).me?.knows).toEqual([]);
    const off = new Driver(spyMulti, makePlayers(7), {
      ...spyMulti.defaultConfig,
      spyCount: 3,
      spiesKnowEachOther: false,
    });
    for (const spy of spiesOf(off.state as HWState)) expect((off.view(spy) as HWView).me?.knows).toEqual([]);
  });
  it('validate rejects too many spies', () => {
    expect(spyMulti.validate!({ ...spyMulti.defaultConfig, spyCount: 3 }, 6)?.k).toBe('err.tooManySpies');
    expect(spyMulti.validate!({ ...spyMulti.defaultConfig, spyCount: 2 }, 6)).toBeNull();
    expect(spyMulti.validate!(spyMulti.defaultConfig, 5)?.k).toBe('err.minPlayers');
  });
});

describe('spy.topic', () => {
  it('spy sees only the category; options are words of that category', () => {
    const d = new Driver(spyTopic, makePlayers(4));
    const s = d.state as HWState;
    const spy = spiesOf(s)[0]!;
    const v = d.view(spy) as HWView;
    expect(v.me?.word).toBeNull();
    expect(v.me?.category).toBeTruthy();
    expect(v.reference).toContain(s.secret);
    const cit = d.view(citizensOf(s)[0]!) as HWView;
    expect(cit.me?.category).toBe(v.me?.category);
  });
  it('respects the selected categories', () => {
    for (let seed = 0; seed < 10; seed++) {
      const d = new Driver(
        spyTopic,
        makePlayers(4),
        { ...spyTopic.defaultConfig, categories: ['میوه'] },
        { seed },
      );
      const spy = spiesOf(d.state as HWState)[0]!;
      expect((d.view(spy) as HWView).me?.category).toBe('میوه');
    }
  });
});

describe('spy.infiltrator / spy.blank (multi-round elimination)', () => {
  it('infiltrator gets the similar word and is not told their role', () => {
    const d = new Driver(spyInfiltrator, makePlayers(5));
    const s = d.state as HWState;
    const inf = Object.entries(s.assign).find(([, a]) => a.roleId === 'infiltrator')![0];
    const v = d.view(inf) as HWView;
    expect(v.me?.roleName).toBeNull();
    expect(v.me?.word).toBeTruthy();
    expect(v.me?.word).not.toBe(s.secret);
    expectNoLeak(v, [s.secret, 'infiltrator', 'نفوذی']);
    const cit = d.view(citizensOf(s)[0]!) as HWView;
    expect(cit.me?.roleName).toBeNull(); // citizens can't be sure either
    expect(cit.me?.word).toBe(s.secret);
  });

  it("eliminated infiltrator guesses the citizens' word: wrong → citizens win, right → infiltrators win", () => {
    for (const right of [false, true]) {
      const d = new Driver(spyInfiltrator, makePlayers(5));
      ackAll(d);
      const s = d.state as HWState;
      const inf = Object.entries(s.assign).find(([, a]) => a.roleId === 'infiltrator')![0];
      d.act('p1', { type: 'startVote' });
      for (const id of d.ids()) d.act(id, { type: 'vote', target: id === inf ? citizensOf(s)[0]! : inf });
      expect((d.state as HWState).phase).toBe('guess');
      expect(d.pending()).toEqual([inf]);
      expect((d.view(inf) as HWView).guess?.options).toBeNull(); // free text
      d.act(inf, { type: 'guess', answer: right ? s.secret : 'هیچی' });
      expect(d.result()!.title.k).toBe(right ? 'hw.result.spies' : 'hw.result.citizens');
    }
  });

  it('wrong eliminations continue the game until infiltrators outnumber', () => {
    const d = new Driver(spyInfiltrator, makePlayers(4));
    ackAll(d);
    const s = d.state as HWState;
    const cits = citizensOf(s);
    // round 1: vote a citizen out
    d.act('p1', { type: 'startVote' });
    const alive1 = (d.state as HWState).alive;
    for (const id of alive1) d.act(id, { type: 'vote', target: id === cits[0] ? cits[1]! : cits[0]! });
    const st = d.state as HWState;
    expect(st.phase).toBe('discuss');
    expect(st.round).toBe(2);
    expect((d.view('public') as HWView).lastOut?.roleName).toBe('شهروند');
    // round 2: another citizen out → 1 infiltrator vs 1 citizen → infiltrators win
    d.act('p1', { type: 'startVote' });
    for (const id of st.alive) d.act(id, { type: 'vote', target: id === cits[1] ? cits[2]! : cits[1]! });
    expect(d.result()!.title.k).toBe('hw.result.spies');
  });

  it('blank who is eliminated may guess: correct → solo win', () => {
    const d = new Driver(spyBlank, makePlayers(6));
    ackAll(d);
    const s = d.state as HWState;
    const blank = Object.entries(s.assign).find(([, a]) => a.roleId === 'blank')![0];
    expect((d.view(blank) as HWView).me?.word).toBeNull();
    expect((d.view(blank) as HWView).me?.roleName).toBe('بی‌کلمه');
    d.act('p1', { type: 'startVote' });
    for (const id of d.ids()) d.act(id, { type: 'vote', target: id === blank ? citizensOf(s)[0]! : blank });
    expect(d.pending()).toEqual([blank]);
    expect((d.view(blank) as HWView).guess?.options).toBeNull(); // free text
    d.act(blank, { type: 'guess', answer: ` ${s.secret.replace(/ی/g, 'ي')} ` }); // normalisation
    const r = d.result()!;
    expect(r.title.k).toBe('hw.result.solo');
    expect(r.winners).toEqual([blank]);
    expect(r.scores[blank]).toBe(3);
  });

  it('blank who guesses wrong → game goes on', () => {
    const d = new Driver(spyBlank, makePlayers(6));
    ackAll(d);
    const s = d.state as HWState;
    const blank = Object.entries(s.assign).find(([, a]) => a.roleId === 'blank')![0];
    d.act('p1', { type: 'startVote' });
    for (const id of d.ids()) d.act(id, { type: 'vote', target: id === blank ? citizensOf(s)[0]! : blank });
    d.act(blank, { type: 'guess', answer: 'نمی‌دانم' });
    expect((d.state as HWState).phase).toBe('discuss');
    expect((d.state as HWState).round).toBe(2);
  });

  it('needs at least one infiltrator or blank', () => {
    expect(
      spyInfiltrator.validate!({ ...spyInfiltrator.defaultConfig, infiltrators: 0, blanks: 0 }, 5)?.k,
    ).toBe('err.needOneSpy');
  });
});

describe('spy.grid', () => {
  it('everyone sees the 16-word grid; only citizens know the secret cell', () => {
    const d = new Driver(spyGrid, makePlayers(4));
    const s = d.state as HWState;
    for (const id of d.ids()) expect((d.view(id) as HWView).grid).toHaveLength(16);
    const spy = spiesOf(s)[0]!;
    expect((d.view(spy) as HWView).me?.word).toBeNull();
    expect((d.view(spy) as HWView).grid).toContain(s.secret);
  });
});

describe('custom information roles (§7.2)', () => {
  it('witness knows the spy and the spy may unmask the witness', () => {
    const cfg = { ...spyClassic.defaultConfig, extraRoles: [{ role: WITNESS, n: 1 }] };
    const d = new Driver(spyClassic, makePlayers(5), cfg);
    const s = d.state as HWState;
    const spy = spiesOf(s)[0]!;
    const witness = Object.entries(s.assign).find(([, a]) => a.roleId === 'witness')![0];
    expect((d.view(witness) as HWView).me?.knows).toEqual([{ id: spy, roleName: 'جاسوس' }]);
    ackAll(d);
    d.act('p1', { type: 'startVote' });
    for (const id of d.ids()) d.act(id, { type: 'vote', target: id === spy ? witness : spy });
    d.act(spy, { type: 'guess', answer: 'غلط' });
    expect((d.state as HWState).phase).toBe('witness');
    expect(d.pending()).toEqual([spy]);
    d.act(spy, { type: 'witnessGuess', target: witness });
    expect(d.result()!.title.k).toBe('hw.result.spies');
  });

  it('a data-only custom role ("double agent": sees nothing, knows spies, citizen team) works without code', () => {
    const doubleAgent = {
      ...WITNESS,
      id: 'double',
      nameFa: 'مأمور دوجانبه',
      sees: 'category' as const,
      onEliminated: 'none' as const,
    };
    const d = new Driver(spyClassic, makePlayers(6), {
      ...spyClassic.defaultConfig,
      extraRoles: [{ role: doubleAgent, n: 1 }],
    });
    const s = d.state as HWState;
    const id = Object.entries(s.assign).find(([, a]) => a.roleId === 'double')![0];
    const v = d.view(id) as HWView;
    expect(v.me?.word).toBeNull();
    expect(v.me?.knows.map((k) => k.id)).toEqual(spiesOf(s));
  });
});

describe('spy.insider', () => {
  it('guide and insider know the word; commons do not', () => {
    const d = new Driver(insider, makePlayers(5));
    const s = d.state as InsiderState;
    expect((d.view(s.guide) as InsiderView).me?.word).toBe(s.word);
    expect((d.view(s.insider) as InsiderView).me?.word).toBe(s.word);
    const common = d.ids().find((id) => id !== s.guide && id !== s.insider)!;
    expectNoLeak(d.view(common), [s.word]);
    expect(JSON.stringify(d.view(common))).not.toContain(`"insider":"${s.insider}"`);
  });

  it('full round: found → discuss → vote catches the insider', () => {
    const d = new Driver(insider, makePlayers(5));
    const s = d.state as InsiderState;
    ackAll(d);
    expect((d.state as InsiderState).phase).toBe('search');
    const finder = d.ids().find((id) => id !== s.guide)!;
    d.noop(
      d.ids().find((id) => id !== s.guide && id !== 'p1')!,
      { type: 'found', finder },
    );
    d.act(s.guide, { type: 'found', finder });
    expect((d.view(finder) as InsiderView).word).toBe(s.word);
    d.advance(120_000);
    expect((d.state as InsiderState).phase).toBe('vote');
    const other = d.ids().find((id) => id !== s.guide && id !== s.insider)!;
    for (const id of d.ids()) d.act(id, { type: 'vote', target: id === s.insider ? other : s.insider });
    const r = d.result()!;
    expect(r.title.k).toBe('insider.result.caught');
    expect(r.winners).not.toContain(s.insider);
  });

  it('time runs out → everybody loses', () => {
    const d = new Driver(insider, makePlayers(4));
    ackAll(d);
    d.advance(300_000);
    expect(d.result()!.title.k).toBe('insider.result.notFound');
    expect(d.result()!.winners).toEqual([]);
  });
});

describe('secret source groups', () => {
  it('never list the same word twice in a category', async () => {
    const { secretGroups } = await import('./sources');
    for (const g of secretGroups({})) expect(new Set(g.words).size).toBe(g.words.length);
    for (const g of secretGroups({ wordPacks: { builtin: ['topics-fa', 'charades-fa'], custom: [] } }))
      expect(new Set(g.words).size).toBe(g.words.length);
  });
});
