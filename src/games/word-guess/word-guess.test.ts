import { describe, expect, it } from 'vitest';
import { Driver, expectNoLeak, makePlayers } from '@/test/harness';
import { performerOf, type WGState, type WGView } from './core';
import { decodePoints, drawing, encodePoints, simplify, type DrawState, type DrawView } from './drawing';
import { charades, forbidden, forehead } from './modes';
import { uniqueClue, uniqueClues, type UniqueState, type UniqueView } from './unique';

const S = (d: Driver) => d.state as WGState;

describe('word-guess team core', () => {
  it('auto teams, alternating performers, correct/skip/score, timer ends the turn', () => {
    const d = new Driver(charades, makePlayers(4), {
      ...charades.defaultConfig,
      turnSeconds: 30,
      targetScore: 0,
    });
    const s = S(d);
    expect(s.teams).toHaveLength(2);
    expect(s.teams.flat().sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(s.totalTurns).toBe(4);
    const first = performerOf(s);
    const mate = s.teams[first.team]!.find((p) => p !== first.player)!;
    const opp = s.teams[1 - first.team]![0]!;
    if (mate !== 'p1') d.noop(mate, { type: 'start' }); // the host may start any turn
    d.act(first.player, { type: 'start' });
    expect(S(d).endsAt).toBe(d.now + 30_000);
    // card visibility: performer + opponents, not the guessing teammates
    expect((d.view(first.player) as WGView).card).not.toBeNull();
    expect((d.view(opp) as WGView).card).not.toBeNull();
    const word = (d.view(first.player) as WGView).card!.word;
    expect((d.view(mate) as WGView).card).toBeNull();
    expectNoLeak(d.view(mate), [word]);
    d.noop(mate, { type: 'correct' });
    d.act(first.player, { type: 'correct' });
    d.act(first.player, { type: 'skip' });
    d.act(first.player, { type: 'correct' });
    expect(S(d).scores[first.team]).toBe(2);
    expect(S(d).pos).toBe(3);
    d.advance(30_000);
    expect(S(d).phase).toBe('turnEnd');
    expect((d.view(mate) as WGView).log.map((l) => l.result)).toEqual(['correct', 'skip', 'correct']);
    d.act(first.player, { type: 'next' });
    expect(performerOf(S(d)).team).toBe(1 - first.team);
  });

  it('full game ends after every player performed; result names the winning team', () => {
    const d = new Driver(charades, makePlayers(4), { ...charades.defaultConfig, targetScore: 0 });
    for (let i = 0; i < 4; i++) {
      const p = performerOf(S(d)).player;
      d.act(p, { type: 'start' });
      if (i === 0) d.act(p, { type: 'correct' });
      d.advance(60_000);
      d.act(p, { type: 'next' });
    }
    const r = d.result()!;
    expect(r.winners).toHaveLength(2);
    expect(r.title.k).toBe('wg.result.team');
  });

  it('forbidden: only opponents can buzz; buzz costs a point', () => {
    const d = new Driver(forbidden, makePlayers(4));
    const { team, player } = performerOf(S(d));
    const mate = S(d).teams[team]!.find((p) => p !== player)!;
    const opp = S(d).teams[1 - team]![0]!;
    d.act(player, { type: 'start' });
    const card = (d.view(opp) as WGView).card!;
    expect(card.extra).toHaveLength(5);
    d.noop(mate, { type: 'buzz' });
    d.noop(player, { type: 'buzz' });
    d.act(opp, { type: 'buzz' });
    expect(S(d).scores[team]).toBe(-1);
  });

  it('skip penalty option', () => {
    const d = new Driver(charades, makePlayers(4), { ...charades.defaultConfig, skipPenalty: true });
    const p = performerOf(S(d)).player;
    d.act(p, { type: 'start' });
    d.act(p, { type: 'skip' });
    expect(S(d).scores[performerOf(S(d)).team]).toBe(-1);
  });

  it('charades filters by category and difficulty', () => {
    const d = new Driver(charades, makePlayers(4), {
      ...charades.defaultConfig,
      categories: ['حیوان'],
      difficulty: 1,
    });
    for (const c of S(d).deck) expect(c.category).toBe('حیوان');
    expect(S(d).deck.length).toBe(6);
  });

  it('forehead: solo play, everybody sees the card (the guesser has it on the forehead)', () => {
    const d = new Driver(forehead, makePlayers(3));
    expect(S(d).teams.every((t) => t.length === 1)).toBe(true);
    const p = performerOf(S(d)).player;
    d.act(p, { type: 'start' });
    for (const id of d.ids()) expect((d.view(id) as WGView).card).not.toBeNull();
    expect(d.pending()).toEqual([]);
  });

  it('pass & play: performer gets the phone during a hidden-card turn', () => {
    const d = new Driver(charades, makePlayers(4), undefined, { local: true });
    d.act('p1', { type: 'start' });
    expect(d.pending()).toEqual([performerOf(S(d)).player]);
  });

  it('validate: teams need at least two players each', () => {
    expect(charades.validate!({ ...charades.defaultConfig, teams: 3 }, 5)?.k).toBe('wg.err.teamSize');
    expect(charades.validate!(charades.defaultConfig, 4)).toBeNull();
  });
});

describe('manual teams & target score', () => {
  it('host-assigned players keep their team; the rest are balanced', () => {
    const manual = { p1: 0, p2: 0, p3: 1 };
    for (let seed = 0; seed < 10; seed++) {
      const d = new Driver(
        charades,
        makePlayers(6),
        { ...charades.defaultConfig, manualTeams: manual },
        { seed },
      );
      const [a, b] = S(d).teams;
      expect(a).toEqual(expect.arrayContaining(['p1', 'p2']));
      expect(b).toContain('p3');
      expect(Math.abs(a!.length - b!.length)).toBeLessThanOrEqual(1);
    }
  });
  it('the game ends at the end of the turn in which a team reaches the target', () => {
    const d = new Driver(charades, makePlayers(4), { ...charades.defaultConfig, targetScore: 3 });
    const p = performerOf(S(d)).player;
    d.act(p, { type: 'start' });
    for (let i = 0; i < 3; i++) d.act(p, { type: 'correct' });
    expect(S(d).phase).toBe('turn'); // the turn still finishes
    d.advance(60_000);
    d.act(p, { type: 'next' });
    expect(S(d).phase).toBe('over');
    expect(d.result()!.winners).toEqual(
      expect.arrayContaining(S(d).teams[performerOf({ ...S(d), turn: 0 }).team]!),
    );
  });
  it('without reaching the target the game keeps going past one round', () => {
    const d = new Driver(charades, makePlayers(4), { ...charades.defaultConfig, targetScore: 50 });
    for (let i = 0; i < 6; i++) {
      const p = performerOf(S(d)).player;
      d.act(p, { type: 'start' });
      d.advance(60_000);
      d.act(p, { type: 'next' });
    }
    expect(S(d).phase).toBe('ready');
  });
});

describe('word.drawing', () => {
  it('hints: off / letter count / letters revealed at 50% and 75% of the time', async () => {
    const { maskWord } = await import('./drawing');
    expect(maskWord('سیب', 'none', [])).toBeNull();
    expect(maskWord('سیب', 'length', [])).toBe('_ _ _');
    expect(maskWord('سیب', 'letters', [1])).toBe('_ ی _');
    const d = new Driver(drawing, makePlayers(3), {
      ...drawing.defaultConfig,
      hints: 'letters',
      turnSeconds: 80,
    });
    const drawer = (d.state as DrawState).order[0]!;
    const g = d.ids().find((p) => p !== drawer)!;
    d.act(drawer, { type: 'start' });
    const word = (d.state as DrawState).words[0]!;
    expect((d.view(g) as DrawView).word).toBeNull(); // the guesser never gets the word itself
    expect((d.state as DrawState).revealed).toEqual([]);
    d.advance(40_000);
    expect((d.state as DrawState).revealed).toHaveLength(1);
    d.advance(20_000);
    expect((d.state as DrawState).revealed).toHaveLength(word.replace(/[ \u200c]/g, '').length > 2 ? 2 : 1);
    expect((d.state as DrawState).phase).toBe('draw');
    d.advance(20_000);
    expect((d.state as DrawState).phase).toBe('reveal');
  });

  it('stroke codec round-trips within quantisation error and simplify shrinks strokes', () => {
    const pts: [number, number][] = Array.from({ length: 50 }, (_, i) => [i / 49, Math.sin(i / 8) / 2 + 0.5]);
    const d = encodePoints(pts);
    expect(d).toHaveLength(200);
    decodePoints(d).forEach(([x, y], i) => {
      expect(Math.abs(x - pts[i]![0])).toBeLessThan(0.0003);
      expect(Math.abs(y - pts[i]![1])).toBeLessThan(0.0003);
    });
    const dense: [number, number][] = Array.from({ length: 200 }, (_, i) => [i / 10000, 0]);
    expect(simplify(dense).length).toBeLessThan(10);
  });

  it('only the drawer sees the word; correct guesses are hidden from others and scored by order', () => {
    const d = new Driver(drawing, makePlayers(4));
    const s = d.state as DrawState;
    const drawer = s.order[0]!;
    const [g1, g2, g3] = d.ids().filter((p) => p !== drawer);
    d.act(drawer, { type: 'start' });
    const word = (d.view(drawer) as DrawView).word!;
    expect(word).toBeTruthy();
    expectNoLeak(d.view(g1!), [word]);
    d.act(drawer, {
      type: 'stroke',
      s: {
        c: 1,
        w: 1,
        d: encodePoints([
          [0.1, 0.1],
          [0.5, 0.5],
        ]),
      },
    });
    d.noop(g1!, { type: 'stroke', s: { c: 1, w: 1, d: 'AAAA' } });
    expect((d.view(g1!) as DrawView).strokes).toHaveLength(1);
    d.act(g1!, { type: 'guess', text: 'اشتباه' });
    d.act(g2!, { type: 'guess', text: ` ${word.replace(/ی/g, 'ي')} ` });
    // g3 must not learn the word from g2's correct guess
    expectNoLeak(d.view(g3!), [word]);
    expect((d.view(g2!) as DrawView).guesses.find((g) => g.p === g2)?.text).toContain(
      word.replace(/ی/g, 'ي'),
    );
    d.noop(g2!, { type: 'guess', text: word });
    d.act(g1!, { type: 'guess', text: word });
    d.act(g3!, { type: 'guess', text: word });
    const st = d.state as DrawState;
    expect(st.phase).toBe('reveal');
    expect([st.scores[g2!], st.scores[g1!], st.scores[g3!]]).toEqual([3, 2, 1]);
    expect(st.scores[drawer]).toBe(3);
  });

  it('paper mode: the drawer marks who guessed; timer reveals', () => {
    const d = new Driver(drawing, makePlayers(3), { ...drawing.defaultConfig, canvas: false });
    const drawer = (d.state as DrawState).order[0]!;
    const other = d.ids().find((p) => p !== drawer)!;
    d.act(drawer, { type: 'start' });
    d.act(drawer, { type: 'mark', player: other });
    expect((d.state as DrawState).solved).toEqual([other]);
    d.advance(80_000);
    expect((d.state as DrawState).phase).toBe('reveal');
    expect((d.view(other) as DrawView).word).toBeTruthy();
  });

  it('rejects malformed strokes (schema)', () => {
    const d = new Driver(drawing, makePlayers(3));
    const drawer = (d.state as DrawState).order[0]!;
    d.act(drawer, { type: 'start' });
    expect(d.runner.dispatch({ type: 'stroke', s: { c: 99, w: 0, d: 'AAAA' } }, drawer, d.now).ok).toBe(
      false,
    );
    expect(d.runner.dispatch({ type: 'stroke', s: { c: 0, w: 0, d: '<script>' } }, drawer, d.now).ok).toBe(
      false,
    );
  });
});

describe('word.unique', () => {
  it('removes duplicate clues (with normalisation) and clues equal to the word', () => {
    expect(uniqueClues({ a: 'گربه', b: 'گربه‌', c: 'سگ', d: 'موش' }, 'موش').sort()).toEqual(['c']);
    expect(uniqueClues({ a: 'كتاب', b: 'کتاب', c: 'دفتر' }, 'مداد')).toEqual(['c']);
  });

  it('guesser never sees the word or the removed clues; auto judge + table override', () => {
    const d = new Driver(uniqueClue, makePlayers(4), { ...uniqueClue.defaultConfig, rounds: 3 });
    const s = d.state as UniqueState;
    const guesser = s.players[0]!.id;
    const word = s.words[0]!;
    expect((d.view(guesser) as UniqueView).word).toBeNull();
    const others = d.ids().filter((p) => p !== guesser);
    d.noop(guesser, { type: 'clue', text: 'x' });
    d.act(others[0]!, { type: 'clue', text: 'تکراری' });
    expectNoLeak(d.view(others[1]!), ['تکراری']); // clues are secret while writing
    d.act(others[1]!, { type: 'clue', text: 'تكراري' });
    d.act(others[2]!, { type: 'clue', text: 'یکتا کلمه' }); // only the first word counts
    const gv = d.view(guesser) as UniqueView;
    expect(gv.clues).toEqual([{ p: others[2], text: 'یکتا', kept: true }]);
    expectNoLeak(gv, [word, 'تکراری']);
    d.act(guesser, { type: 'guess', text: 'غلط' });
    expect((d.state as UniqueState).correct).toBe(false);
    d.act('p1', { type: 'accept' }); // host overrides (synonym)
    expect((d.state as UniqueState).score).toBe(1);
    d.act('p1', { type: 'next' });
    expect((d.state as UniqueState).round).toBe(1);
  });
});
