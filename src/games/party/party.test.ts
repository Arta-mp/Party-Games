import { describe, expect, it } from 'vitest';
import { Driver, expectNoLeak, makePlayers } from '@/test/harness';
import { autoValid, esmFamil, scoreRound, type EsmState, type EsmView } from './esmfamil';
import { mostLikely, type MLState, type MLView } from './mostlikely';
import { truthDare, type TDState } from './truthdare';

describe('party.esmfamil', () => {
  it('validates first letters with Persian normalisation', () => {
    expect(autoValid('آمل', 'ا')).toBe(true);
    expect(autoValid('اراک', 'ا')).toBe(true);
    expect(autoValid('كرمان', 'ک')).toBe(true); // Arabic kaf
    expect(autoValid('تهران', 'ک')).toBe(false);
    expect(autoValid('ک', 'ک')).toBe(false); // too short
    expect(autoValid('', 'ک')).toBe(false);
  });

  it('scores unique 10, duplicate 5, sole answer 20, invalid 0', () => {
    const d = new Driver(esmFamil, makePlayers(3), {
      ...esmFamil.defaultConfig,
      columns: ['اسم', 'شهر', 'غذا'],
    });
    const s = d.state as EsmState;
    const L = s.letter;
    const fake: EsmState = {
      ...s,
      letter: 'م',
      answers: {
        p1: ['مریم', 'مشهد', 'ماکارونی'],
        p2: ['مریم', 'مراغه', ''],
        p3: ['مهدی', 'تهران', ''],
      },
    };
    void L;
    const sc = scoreRound(fake);
    expect(sc.p1).toEqual([5, 10, 20]);
    expect(sc.p2).toEqual([5, 10, 0]);
    expect(sc.p3).toEqual([10, 0, 0]);
  });

  it('online: answers stay private while writing; stop needs full answers; grace timer then judging', () => {
    const d = new Driver(esmFamil, makePlayers(3), {
      ...esmFamil.defaultConfig,
      columns: ['اسم', 'شهر', 'غذا'],
      stopGraceSeconds: 5,
    });
    const s = d.state as EsmState;
    const L = s.letter;
    d.act('p1', { type: 'answers', answers: [`${L}ینا`, `${L}شهر`, `${L}غذا`] });
    d.act('p2', { type: 'answers', answers: [`${L}هدی`, '', ''] });
    expectNoLeak(d.view('p2'), [`${L}ینا`]);
    expect((d.view('p2') as EsmView).board).toBeNull();
    d.noop('p2', { type: 'stop' }); // p2 has empty answers
    d.act('p1', { type: 'stop' });
    const st = d.state as EsmState;
    expect(st.stoppedBy).toBe('p1');
    expect(st.endsAt).toBe(d.now + 5000);
    d.act('p2', { type: 'answers', answers: [`${L}هدی`, `${L}ملا`, ''] }); // still allowed during grace
    d.advance(5000);
    expect((d.state as EsmState).phase).toBe('judge');
    const v = d.view('p3') as EsmView;
    expect(v.board?.find((b) => b.player === 'p1')?.answers[0]).toBe(`${L}ینا`);
    expect(v.board?.find((b) => b.player === 'p2')?.answers[1]).toBe(`${L}ملا`);
  });

  it('majority rejection invalidates an answer; host finishes judging and next round picks a new letter', () => {
    const d = new Driver(esmFamil, makePlayers(3), {
      ...esmFamil.defaultConfig,
      columns: ['اسم', 'شهر', 'غذا'],
      rounds: 2,
    });
    const L = (d.state as EsmState).letter;
    d.act('p1', { type: 'answers', answers: [`${L}الکی`, '', ''] });
    d.advance(120_000);
    d.noop('p1', { type: 'reject', player: 'p1', col: 0, reject: true }); // not your own answer
    d.act('p2', { type: 'reject', player: 'p1', col: 0, reject: true });
    expect((d.view('p3') as EsmView).board![0]!.valid[0]).toBe(true); // 1 of 2 others is not a majority
    d.act('p3', { type: 'reject', player: 'p1', col: 0, reject: true });
    expect((d.view('p3') as EsmView).board![0]!.valid[0]).toBe(false);
    d.noop('p2', { type: 'finishJudge' });
    d.act('p1', { type: 'finishJudge' });
    expect((d.state as EsmState).phase).toBe('scored');
    expect((d.state as EsmState).totals.p1).toBe(0);
    d.act('p1', { type: 'nextRound' });
    const s2 = d.state as EsmState;
    expect(s2.round).toBe(2);
    expect(s2.letter).not.toBe(L);
    d.advance(120_000);
    d.act('p1', { type: 'finishJudge' });
    expect(d.result()).not.toBeNull();
  });

  it('pass & play: one writer at a time with a personal timer', () => {
    const d = new Driver(
      esmFamil,
      makePlayers(2),
      { ...esmFamil.defaultConfig, columns: ['اسم', 'شهر', 'غذا'] },
      { local: true },
    );
    expect(d.pending()).toEqual(['p1']);
    expect(d.runner.deadline()).toBeNull();
    d.noop('p2', { type: 'startTurn' });
    d.act('p1', { type: 'startTurn' });
    expect(d.runner.deadline()).toBe(d.now + 120_000);
    d.act('p1', { type: 'stop' });
    expect(d.pending()).toEqual(['p2']);
    d.act('p2', { type: 'startTurn' });
    d.advance(120_000); // p2 runs out of time → auto submit
    expect((d.state as EsmState).phase).toBe('judge');
  });
});

describe('party.mostlikely', () => {
  it('secret votes, bar chart reveal, +1 for voting with the majority', () => {
    const d = new Driver(mostLikely, makePlayers(4), { ...mostLikely.defaultConfig, rounds: 2 });
    expect((d.view('p1') as MLView).question).toMatch(/^کی /);
    d.act('p1', { type: 'vote', target: 'p3' });
    // nobody sees who voted for whom while voting
    expect((d.view('p2') as MLView).tally).toBeNull();
    expect((d.view('p2') as MLView).voted).toEqual(['p1']);
    expect(d.pending()).toEqual(['p2', 'p3', 'p4']);
    d.act('p2', { type: 'vote', target: 'p3' });
    d.act('p3', { type: 'vote', target: 'p1' });
    d.act('p4', { type: 'vote', target: 'p3' });
    const s = d.state as MLState;
    expect(s.phase).toBe('reveal');
    expect(s.tally).toEqual({ p3: 3, p1: 1 });
    expect(s.points).toEqual({ p1: 1, p2: 1, p3: 0, p4: 1 });
    d.act('p1', { type: 'next' });
    for (const id of d.ids()) d.act(id, { type: 'vote', target: 'p2' });
    d.act('p1', { type: 'next' });
    expect(d.result()?.winners.sort()).toEqual(
      ['p1', 'p2', 'p3', 'p4'].filter((id) => (d.state as MLState).points[id] === 2).sort(),
    );
  });
  it('can forbid self votes; uses only most-likely questions', () => {
    const d = new Driver(mostLikely, makePlayers(3), { ...mostLikely.defaultConfig, allowSelf: false });
    d.noop('p1', { type: 'vote', target: 'p1' });
    for (const q of (d.state as MLState).questions) expect(q.startsWith('کی ')).toBe(true);
  });
});

describe('party.truthdare', () => {
  it('spin → choose → task → score, never the same player twice in a row', () => {
    const d = new Driver(truthDare, makePlayers(3), {
      ...truthDare.defaultConfig,
      turns: 6,
      categories: ['family'],
    });
    let last: string | null = null;
    for (let i = 0; i < 6; i++) {
      d.noop('p2', { type: 'spin' });
      d.act('p1', { type: 'spin' });
      const s = d.state as TDState;
      expect(s.current).not.toBe(last);
      last = s.current;
      const other = d.ids().find((x) => x !== s.current)!;
      d.noop(other, { type: 'choose', kind: 'dare' });
      d.act(s.current!, { type: 'choose', kind: i % 2 ? 'dare' : 'truth' });
      expect((d.state as TDState).prompt).toBeTruthy();
      d.act(s.current!, { type: 'done', ok: true });
    }
    expect(d.result()).not.toBeNull();
    const pts = Object.values((d.state as TDState).points).reduce((a, b) => a + b, 0);
    expect(pts).toBe(3 * 1 + 3 * 2);
  });
  it('only the enabled categories are served (e.g. +18 only when chosen)', async () => {
    const { itemsOf } = await import('@/content/builtin');
    const all = itemsOf('questions', { builtin: ['truthdare-fa'], custom: [] });
    for (const cats of [['family'], ['couples', 'colleagues'], ['adult']] as const) {
      const allowed = all
        .filter((q) => (cats as readonly string[]).includes(q.level ?? 'family'))
        .map((q) => q.q);
      const d = new Driver(truthDare, makePlayers(2), {
        ...truthDare.defaultConfig,
        turns: 30,
        categories: [...cats],
      });
      for (let i = 0; i < 12; i++) {
        d.act('p1', { type: 'spin' });
        const cur = (d.state as TDState).current!;
        d.act(cur, { type: 'choose', kind: i % 2 ? 'dare' : 'truth' });
        expect(allowed).toContain((d.state as TDState).prompt);
        d.act(cur, { type: 'done', ok: false });
      }
    }
    expect(truthDare.defaultConfig.categories).not.toContain('adult');
  });
  it('another player can replace the card with their own truth/dare', () => {
    const d = new Driver(truthDare, makePlayers(3));
    d.act('p1', { type: 'spin' });
    const cur = (d.state as TDState).current!;
    const other = d.ids().find((p) => p !== cur)!;
    d.act(cur, { type: 'choose', kind: 'dare' });
    d.noop(cur, { type: 'custom', text: 'یه جرأت ساختگی' }); // not for yourself
    d.act(other, { type: 'custom', text: 'با لهجه‌ی شیرازی آواز بخوان' });
    expect((d.state as TDState).prompt).toBe('با لهجه‌ی شیرازی آواز بخوان');
    expect((d.state as TDState).author).toBe(other);
    d.act(cur, { type: 'done', ok: true });
    expect((d.state as TDState).author).toBeNull();
  });
});

describe('party design options', () => {
  it('esm famil accepts host-added custom columns', () => {
    const d = new Driver(esmFamil, makePlayers(2), {
      ...esmFamil.defaultConfig,
      columns: ['اسم', 'برند', 'فوتبالیست'],
    });
    expect((d.view('p1') as EsmView).columns).toEqual(['اسم', 'برند', 'فوتبالیست']);
  });
  it('most likely: voters are shown only when the host enables it', () => {
    for (const revealVoters of [false, true]) {
      const d = new Driver(mostLikely, makePlayers(3), { ...mostLikely.defaultConfig, revealVoters });
      for (const id of d.ids()) d.act(id, { type: 'vote', target: 'p2' });
      const v = d.view('p1') as MLView;
      expect(v.voters).toEqual(revealVoters ? { p1: 'p2', p2: 'p2', p3: 'p2' } : null);
    }
    // never during voting
    const d = new Driver(mostLikely, makePlayers(3), { ...mostLikely.defaultConfig, revealVoters: true });
    d.act('p1', { type: 'vote', target: 'p3' });
    expect((d.view('p2') as MLView).voters).toBeNull();
  });
});
