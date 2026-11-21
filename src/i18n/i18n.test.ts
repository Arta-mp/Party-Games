import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAMILIES, META } from '@/games/meta';
import { NIGHT_ACTIONS, PASSIVES, TARGETS } from '@/custom/schemas';
import { PACK_KINDS } from '@/custom/packText';
import { fa } from './fa';
import { en } from './en';
import { translate } from './index';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

const has = (k: string) => k in fa;

describe('i18n', () => {
  it('every literal key used in the source exists in fa.ts', () => {
    const missing = new Set<string>();
    for (const f of files(join(__dirname, '..'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.-]+)'/g))
        if (!has(m[1]!)) missing.add(`${m[1]} (${f.split('src/')[1]})`);
      for (const m of src.matchAll(/\bk: '([a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+)'/g))
        if (!has(m[1]!) && !/^tut\.\d$/.test(m[1]!)) missing.add(`${m[1]} (${f.split('src/')[1]})`);
      for (const m of src.matchAll(/reason = '([a-zA-Z0-9_.-]+)'/g)) if (!has(m[1]!)) missing.add(m[1]!);
    }
    expect([...missing]).toEqual([]);
  });

  it('every game has name, description and a 3-step how-to', () => {
    for (const id of Object.keys(META))
      for (const s of ['name', 'desc', 'how1', 'how2', 'how3'])
        expect(has(`game.${id}.${s}`), `game.${id}.${s}`).toBe(true);
    for (const f of FAMILIES) {
      expect(has(`family.${f.id}`)).toBe(true);
      expect(has(`family.${f.id}.desc`)).toBe(true);
    }
  });

  it('dynamic key families are complete', () => {
    const keys = [
      ...NIGHT_ACTIONS.flatMap((a) => [`mafia.action.${a}`, `mafia.actionPrompt.${a}`]),
      ...TARGETS.map((x) => `custom.target.${x}`),
      ...PASSIVES.map((x) => `custom.passive.${x}`),
      ...PACK_KINDS.flatMap((k) => [`custom.kind.${k}`, `custom.format.${k}`]),
      ...['citizens', 'mafia', 'neutral'].map((x) => `mafia.team.${x}`),
      ...['short', 'long', 'chars'].map((x) => `name.err.${x}`),
      ...['kicked', 'locked', 'in-game', 'full'].map((x) => `lobby.denied.${x}`),
      ...['guide', 'insider', 'common'].flatMap((x) => [`insider.role.${x}`, `insider.desc.${x}`]),
      ...['notFound', 'caught', 'escaped'].map((x) => `insider.result.${x}`),
      ...['won', 'assassin', 'time'].map((x) => `duet.result.${x}`),
      ...[1, 2, 3, 4].flatMap((i) => [`tut.${i}.title`, `tut.${i}.body`]),
      ...['family', 'friends', 'spicy'].map((x) => `td.level.${x}`),
    ];
    expect(keys.filter((k) => !has(k))).toEqual([]);
  });

  it('English covers every Persian key (phase 6)', () => {
    const missing = Object.keys(fa).filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it('interpolates params with localised digits', () => {
    expect(translate('fa', 'hw.round', { n: 3 })).toBe('دور ۳');
    expect(translate('en', 'hw.round', { n: 3 })).toBe('Round 3');
    expect(translate('fa', 'no.such.key')).toBe('no.such.key');
  });
});
