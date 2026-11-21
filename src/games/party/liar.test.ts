import { describe, expect, it } from 'vitest';
import { Driver, expectNoLeak, makePlayers } from '@/test/harness';
import { liar, type LiarState, type LiarView } from './liar';

describe('party.liar', () => {
  it('lies are secret, the truth is mixed in, own lie is hidden, scoring +2 / +1', () => {
    const d = new Driver(liar, makePlayers(3), { ...liar.defaultConfig, rounds: 2 });
    const s = () => d.state as LiarState;
    const truth = s().questions[0]!.answer;
    expect(d.runner.dispatch({ type: 'lie', text: ` ${truth} ` }, 'p1', d.now)).toEqual({ ok: false, error: 'liar-too-true' });
    d.act('p1', { type: 'lie', text: 'دروغ یک' });
    expectNoLeak(d.view('p2'), ['دروغ یک', truth]);
    d.act('p2', { type: 'lie', text: 'دروغ دو' });
    d.act('p3', { type: 'lie', text: 'دروغ  یک' }); // same lie as p1 (normalised) → merged
    expect(s().phase).toBe('pick');
    expect(s().options).toHaveLength(3);
    const v1 = d.view('p1') as LiarView;
    expect(v1.options!.map((o) => o.text)).not.toContain('دروغ یک');
    const idx = (txt: string) => s().options.findIndex((o) => o.text === txt);
    d.noop('p1', { type: 'pick', option: idx('دروغ یک') });
    d.act('p1', { type: 'pick', option: idx(truth) }); // +2
    d.act('p2', { type: 'pick', option: idx('دروغ یک') }); // fooled by p1 & p3 → +1 each
    d.act('p3', { type: 'pick', option: idx('دروغ دو') }); // fooled by p2 → +1
    expect(s().scores).toEqual({ p1: 3, p2: 1, p3: 1 });
    const r = d.view('p2') as LiarView;
    expect(r.reveal?.find((o) => o.truth)?.text).toBe(truth);
    d.act('p1', { type: 'next' });
    expect(s().phase).toBe('write');
  });
});
