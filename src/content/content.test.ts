import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeFa } from '@/lib/normalize';
import { packSchema } from './schema';
import { BUILTIN_PACKS, itemsOf } from './builtin';

const dir = join(__dirname, 'packs');

describe('content packs (CI schema check, §11.1)', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  it.each(files)('%s is a valid pack', (file) => {
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const res = packSchema.safeParse(raw);
    if (!res.success) throw new Error(JSON.stringify(res.error.issues.slice(0, 5), null, 2));
    expect(`${res.data.id}.json`).toBe(file);
  });

  it.each(files)('%s has no duplicate items', (file) => {
    const pack = packSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    const keys = pack.items.map((it) => normalizeFa(JSON.stringify(it)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('pack ids are unique', () => {
    const ids = BUILTIN_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has at least 30 Persian locations with roles (phase 1 gate)', () => {
    const locs = itemsOf('locations', undefined);
    expect(locs.length).toBeGreaterThanOrEqual(30);
    for (const l of locs) expect(l.roles.length).toBeGreaterThanOrEqual(5);
  });

  it('falls back to all built-in packs when nothing is selected', () => {
    expect(itemsOf('pairs', { builtin: [], custom: [] }).length).toBe(itemsOf('pairs', undefined).length);
  });

  it('custom packs embedded in a config are used', () => {
    const items = itemsOf('pairs', { builtin: ['nope'], custom: [{ id: 'mine', kind: 'pairs', nameFa: 'من', items: [{ a: 'x', b: 'y' }] }] });
    expect(items).toEqual([{ a: 'x', b: 'y' }]);
  });
});
