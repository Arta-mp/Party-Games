import { describe, expect, it } from 'vitest';
import { Driver, makePlayers } from '@/test/harness';
import { codewords, type CWState, type CWView } from './codewords';
import { DUET_CELLS, duet, type DuetState, type DuetView } from './duet';
import { pointsFor, spectrum, type SpecState, type SpecView } from './spectrum';

describe('board.codewords', () => {
  const setup = () => {
    const d = new Driver(codewords, makePlayers(4));
    return { d, s: () => d.state as CWState };
  };
  it('deals 9/8/7/1 and only captains see the key', () => {
    const { d, s } = setup();
    const key = s().key;
    const first = s().turn;
    expect(key.filter((k) => k === first)).toHaveLength(9);
    expect(key.filter((k) => k === (first === 'red' ? 'blue' : 'red'))).toHaveLength(8);
    expect(key.filter((k) => k === 'neutral')).toHaveLength(7);
    expect(key.filter((k) => k === 'black')).toHaveLength(1);
    const cap = s().captains.red;
    const op = s().teams.red.find((p) => p !== cap)!;
    expect((d.view(cap) as CWView).colors.every((c) => c !== null)).toBe(true);
    expect((d.view(op) as CWView).colors.every((c) => c === null)).toBe(true);
    expect((d.view('public') as CWView).colors.every((c) => c === null)).toBe(true);
  });
  it('clue rules, guess limits, wrong colour ends the turn, black loses', () => {
    const { d, s } = setup();
    const team = s().turn;
    const cap = s().captains[team];
    const op = s().teams[team].find((p) => p !== cap)!;
    const opp = s().teams[team === 'red' ? 'blue' : 'red'][0]!;
    d.noop(op, { type: 'clue', word: 'x', count: 1 });
    expect(d.runner.dispatch({ type: 'clue', word: s().words[0]!, count: 1 }, cap, d.now)).toEqual({
      ok: false,
      error: 'clue-on-board',
    });
    d.act(cap, { type: 'clue', word: 'سرنخ', count: 1 });
    expect(s().guessesLeft).toBe(2);
    d.noop(opp, { type: 'reveal', index: 0 });
    d.noop(cap, { type: 'reveal', index: 0 });
    const mine = s().key.findIndex((k) => k === team);
    d.act(op, { type: 'reveal', index: mine });
    expect(s().turn).toBe(team);
    const neutral = s().key.findIndex((k) => k === 'neutral');
    d.act(op, { type: 'reveal', index: neutral });
    expect(s().turn).not.toBe(team);
    expect((d.view(opp) as CWView).colors[neutral]).toBe('neutral');
    // other team hits the black card → first team wins
    const cap2 = s().captains[s().turn];
    const op2 = s().teams[s().turn].find((p) => p !== cap2)!;
    d.act(cap2, { type: 'clue', word: 'خطر', count: 2 });
    d.act(op2, { type: 'reveal', index: s().key.indexOf('black') });
    expect(d.result()?.title.k).toBe(`cw.result.${team}`);
  });
  it('finding all your cards wins', () => {
    const { d, s } = setup();
    const team = s().turn;
    const cap = s().captains[team];
    const op = s().teams[team].find((p) => p !== cap)!;
    d.act(cap, { type: 'clue', word: 'همه', count: 0 });
    s().key.forEach((k, i) => k === team && s().phase === 'guess' && d.act(op, { type: 'reveal', index: i }));
    expect(d.result()?.winners.sort()).toEqual([...s().teams[team]].sort());
  });
});

describe('board.duet', () => {
  it('key distribution: 9 agents and 3 assassins per side, 15 agents total', () => {
    const a = DUET_CELLS.map((c) => c[0]);
    const b = DUET_CELLS.map((c) => c[1]);
    expect(DUET_CELLS).toHaveLength(25);
    expect(a.filter((k) => k === 'G')).toHaveLength(9);
    expect(b.filter((k) => k === 'G')).toHaveLength(9);
    expect(a.filter((k) => k === 'A')).toHaveLength(3);
    expect(b.filter((k) => k === 'A')).toHaveLength(3);
    expect(DUET_CELLS.filter((c) => c[0] === 'G' || c[1] === 'G')).toHaveLength(15);
  });
  it("each player sees only their own key; guessing uses the giver's key", () => {
    const d = new Driver(duet, makePlayers(2));
    const s = () => d.state as DuetState;
    expect((d.view('p1') as DuetView).myKey).toEqual(s().keys[0]);
    expect(JSON.stringify(d.view('p1'))).not.toContain(JSON.stringify(s().keys[1]));
    d.noop('p2', { type: 'clue', word: 'x', count: 1 });
    d.act('p1', { type: 'clue', word: 'سرنخ', count: 2 });
    expect(d.pending()).toEqual(['p2']);
    const g = s().keys[0].findIndex((k, i) => k === 'G' && s().keys[1][i] !== 'A');
    d.act('p2', { type: 'reveal', index: g });
    expect(s().found[g]).toBe(true);
    const n = s().keys[0].findIndex((k) => k === 'N');
    d.act('p2', { type: 'reveal', index: n });
    expect(s().neutral[0][n]).toBe(true);
    expect(s().giver).toBe(1);
    expect(s().turnsLeft).toBe(8);
    d.act('p2', { type: 'clue', word: 'بعدی', count: 1 });
    d.act('p1', { type: 'reveal', index: s().keys[1].indexOf('A') });
    expect(d.result()?.title.k).toBe('duet.result.assassin');
  });
  it('requires exactly two players', () => {
    expect(duet.validate!(duet.defaultConfig, 3)?.k).toBe('duet.err.two');
  });
});

describe('board.spectrum', () => {
  it('scoring bands', () => {
    expect(pointsFor(50, 50)).toBe(4);
    expect(pointsFor(54, 50)).toBe(4);
    expect(pointsFor(60, 50)).toBe(3);
    expect(pointsFor(70, 50)).toBe(2);
    expect(pointsFor(71, 50)).toBe(0);
  });
  it('target is hidden from everyone but the psychic; dial → lock → counter → reveal', () => {
    const d = new Driver(spectrum, makePlayers(4));
    const s = () => d.state as SpecState;
    const teamIdx = 0;
    const psychic = s().teams[teamIdx]![0]!;
    const mate = s().teams[teamIdx]![1]!;
    const opp = s().teams[1]![0]!;
    expect((d.view(psychic) as SpecView).target).toBe(s().target);
    expect((d.view(mate) as SpecView).target).toBeNull();
    expect((d.view(opp) as SpecView).target).toBeNull();
    d.act(psychic, { type: 'clue', text: 'سرنخ' });
    expect((d.view(psychic) as SpecView).target).toBeNull(); // psychic can't help during the dial
    d.noop(opp, { type: 'dial', value: 10 });
    d.act(mate, { type: 'dial', value: s().target });
    d.act(mate, { type: 'lock' });
    d.noop(mate, { type: 'counter', side: 'left' });
    d.act(opp, { type: 'counter', side: 'left' });
    expect(s().scores[0]).toBe(4);
    expect(s().scores[1]).toBe(0); // bull's-eye: no counter point
    expect((d.view(opp) as SpecView).target).toBe(s().target);
  });
  it('counter-bet earns a point when right', () => {
    const d = new Driver(spectrum, makePlayers(4));
    const s = () => d.state as SpecState;
    const [psychic, mate] = s().teams[0]!;
    const opp = s().teams[1]![0]!;
    d.act(psychic!, { type: 'clue', text: 'x' });
    const dial = s().target > 50 ? s().target - 10 : s().target + 10;
    d.act(mate!, { type: 'dial', value: dial });
    d.act(mate!, { type: 'lock' });
    d.act(opp, { type: 'counter', side: s().target > dial ? 'right' : 'left' });
    expect(s().scores).toEqual([3, 1]);
  });
});

describe('board design options', () => {
  it('codewords: host-chosen teams and captains are respected', () => {
    for (let seed = 0; seed < 8; seed++) {
      const d = new Driver(
        codewords,
        makePlayers(6),
        {
          ...codewords.defaultConfig,
          manualTeams: { p1: 0, p2: 0, p3: 1, p4: 1 },
          captains: { red: 'p2', blue: 'p4' },
        },
        { seed },
      );
      const s = d.state as CWState;
      expect(s.teams.red).toEqual(expect.arrayContaining(['p1', 'p2']));
      expect(s.teams.blue).toEqual(expect.arrayContaining(['p3', 'p4']));
      expect(s.captains).toEqual({ red: 'p2', blue: 'p4' });
      expect(s.teams.red.length + s.teams.blue.length).toBe(6);
    }
  });
  it('codewords: a captain not on that team falls back to a random member of the team', () => {
    const d = new Driver(codewords, makePlayers(4), {
      ...codewords.defaultConfig,
      manualTeams: { p1: 0 },
      captains: { blue: 'p1' },
    });
    const s = d.state as CWState;
    expect(s.teams.blue).toContain(s.captains.blue);
    expect(s.captains.blue).not.toBe('p1');
  });
  it('duet difficulty sets the number of turns', () => {
    expect(
      (new Driver(duet, makePlayers(2), { ...duet.defaultConfig, difficulty: 'easy' }).state as DuetState)
        .turnsLeft,
    ).toBe(11);
    expect((new Driver(duet, makePlayers(2)).state as DuetState).turnsLeft).toBe(9);
    expect(
      (new Driver(duet, makePlayers(2), { ...duet.defaultConfig, difficulty: 'hard' }).state as DuetState)
        .turnsLeft,
    ).toBe(7);
  });
  it('spectrum co-op: one team, no counter-bet, fixed rounds, score out of 4 × rounds', () => {
    const d = new Driver(spectrum, makePlayers(3), { ...spectrum.defaultConfig, mode: 'coop', maxRounds: 2 });
    const s = () => d.state as SpecState;
    expect(s().teams).toHaveLength(1);
    for (let r = 0; r < 2; r++) {
      const psychic = (d.view('public') as SpecView).psychic;
      const mate = d.ids().find((p) => p !== psychic)!;
      d.act(psychic, { type: 'clue', text: 'x' });
      d.act(mate, { type: 'dial', value: s().target });
      d.act(mate, { type: 'lock' });
      expect(s().phase).toBe('reveal');
      d.act('p1', { type: 'next' });
    }
    expect(s().scores).toEqual([8]);
    const r = d.result()!;
    expect(r.title).toEqual({ k: 'spec.coopResult', p: { n: 8, max: 8 } });
    expect(r.winners).toHaveLength(3);
  });
});
