import { describe, expect, it } from 'vitest';
import { packSchema } from '@/content/schema';
import { MAFIA_ROLES } from '@/games/social-deduction/roles';
import { WITNESS } from '@/games/hidden-word/core';
import { itemToLine, parsePackText, PACK_KINDS } from './packText';
import { decodeShare, encodeShare, parseImport, shareLink } from './share';
import { abilityRoleSchema, infoRoleSchema } from './schemas';

describe('share codes (lz-string)', () => {
  it('round-trips an ability role and validates on decode', () => {
    const code = encodeShare({ v: 1, kind: 'ability-role', data: MAFIA_ROLES.sniper });
    expect(code).toMatch(/^[A-Za-z0-9+\-$]+$/);
    const back = decodeShare(code);
    expect(back?.kind).toBe('ability-role');
    expect(back?.data).toEqual(MAFIA_ROLES.sniper);
  });
  it('rejects tampered or invalid data (no eval, schema only)', () => {
    expect(decodeShare('garbage')).toBeNull();
    const bad = encodeShare({ v: 1, kind: 'info-role', data: { ...WITNESS, sees: 'everything' } } as never);
    expect(decodeShare(bad)).toBeNull();
    const evil = encodeShare({
      v: 1,
      kind: 'ability-role',
      data: { ...MAFIA_ROLES.doctor, night: [{ action: 'eval(alert(1))' }] },
    } as never);
    expect(decodeShare(evil)).toBeNull();
  });
  it('parses links, bare codes and exported JSON', () => {
    const payload = { v: 1 as const, kind: 'info-role' as const, data: WITNESS };
    const link = shareLink(payload, 'https://x.github.io/party-games/');
    expect(link).toContain('#/import/');
    expect(parseImport(link)?.data).toEqual(WITNESS);
    expect(parseImport(encodeShare(payload))?.data).toEqual(WITNESS);
    expect(parseImport(JSON.stringify(payload))?.data).toEqual(WITNESS);
  });
  it('bundles several items', () => {
    const code = encodeShare({
      v: 1,
      kind: 'bundle',
      data: { packs: [], infoRoles: [WITNESS], abilityRoles: [MAFIA_ROLES.doctor] },
    });
    const b = decodeShare(code);
    expect(b?.kind === 'bundle' && b.data.abilityRoles[0]?.id).toBe('doctor');
  });
  it('role schemas reject bad input', () => {
    expect(
      infoRoleSchema.safeParse({ id: 'X Y', nameFa: 'a', team: 'citizens', sees: 'secret' }).success,
    ).toBe(false);
    expect(abilityRoleSchema.safeParse({ id: 'ok', nameFa: 'a', team: 'aliens' }).success).toBe(false);
    expect(
      abilityRoleSchema.safeParse({
        id: 'ok',
        nameFa: 'a',
        team: 'mafia',
        night: { action: 'kill', uses: 0 },
      }).success,
    ).toBe(false);
  });
});

describe('pack text format', () => {
  const meta = (kind: Parameters<typeof parsePackText>[0]['kind']) => ({
    id: 'my-pack',
    nameFa: 'پک من',
    kind,
  });
  it('parses every kind', () => {
    expect(parsePackText(meta('words'), 'پیتزا | غذا | ۲\nچای').pack?.items).toEqual([
      { word: 'پیتزا', category: 'غذا', difficulty: 2 },
      { word: 'چای' },
    ]);
    expect(parsePackText(meta('locations'), 'نانوایی: نانوا، شاطر، مشتری').pack?.items).toEqual([
      { name: 'نانوایی', roles: ['نانوا', 'شاطر', 'مشتری'] },
    ]);
    expect(parsePackText(meta('pairs'), 'چای / قهوه').pack?.items).toEqual([{ a: 'چای', b: 'قهوه' }]);
    expect(parsePackText(meta('cards'), 'دریا: آب، موج، ساحل، شنا، آبی').pack?.items[0]).toMatchObject({
      word: 'دریا',
    });
    expect(parsePackText(meta('spectrums'), 'سرد / داغ').pack?.items).toEqual([
      { left: 'سرد', right: 'داغ' },
    ]);
    expect(parsePackText(meta('questions'), 'سؤال تست؟ | family | truth').pack?.items).toEqual([
      { q: 'سؤال تست؟', level: 'family', type: 'truth' },
    ]);
    expect(parsePackText(meta('trivia'), 'پایتخت استرالیا؟ | کانبرا').pack?.items).toEqual([
      { q: 'پایتخت استرالیا؟', answer: 'کانبرا' },
    ]);
    expect(parsePackText(meta('columns'), 'گل').pack?.items).toEqual([{ name: 'گل' }]);
  });
  it('reports bad lines with line numbers', () => {
    const r = parsePackText(meta('cards'), 'خوب: ۱، ۲، ۳، ۴، ۵\nبد: فقط، دو');
    expect(r.pack).toBeNull();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.line).toBe(2);
  });
  it('itemToLine ∘ parse is stable for all built-in-like items', () => {
    for (const kind of PACK_KINDS) {
      const sample: Record<string, Record<string, unknown>> = {
        words: { word: 'سیب', category: 'میوه', difficulty: 1 },
        locations: { name: 'بانک', roles: ['الف', 'ب', 'پ'] },
        pairs: { a: 'الف', b: 'ب' },
        grids: { topic: 'ت', words: Array.from({ length: 16 }, (_, i) => `w${i}`) },
        cards: { word: 'ک', forbidden: ['۱', '۲', '۳', '۴', '۵'] },
        spectrums: { left: 'چپ', right: 'راست' },
        questions: { q: 'سؤال؟؟', level: 'spicy', type: 'dare' },
        trivia: { q: 'سؤال طولانی', answer: 'ج' },
        columns: { name: 'ستون' },
      };
      const line = itemToLine(kind, sample[kind]!);
      const r = parsePackText({ id: 'ab', nameFa: 'ن', kind }, line);
      expect(r.errors).toEqual([]);
      expect(packSchema.parse(r.pack).items[0]).toEqual(sample[kind]);
    }
  });
});
