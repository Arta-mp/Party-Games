import { describe, expect, it } from 'vitest';
import { compactFa, firstLetter, normalizeFa, sameAnswer, faNum } from './normalize';

describe('normalizeFa', () => {
  it('unifies Arabic and Persian yeh/kaf', () => {
    expect(normalizeFa('علي')).toBe('علی');
    expect(normalizeFa('كتاب')).toBe('کتاب');
    expect(sameAnswer('كيك', 'کیک')).toBe(true);
  });
  it('removes diacritics, tatweel and ZWNJ', () => {
    expect(normalizeFa('مُحَمَّد')).toBe('محمد');
    expect(normalizeFa('ســلام')).toBe('سلام');
    expect(compactFa('می‌روم')).toBe(compactFa('میروم'));
    expect(sameAnswer('نیم‌فاصله', 'نیم فاصله')).toBe(true);
  });
  it('handles alef variants, digits, spaces and case', () => {
    expect(normalizeFa('  آب   ')).toBe('اب');
    expect(normalizeFa('۱۲۳')).toBe('123');
    expect(normalizeFa('٤٥')).toBe('45');
    expect(normalizeFa('Tehran')).toBe('tehran');
    expect(sameAnswer('', '')).toBe(false);
  });
  it('firstLetter treats آ as ا', () => {
    expect(firstLetter('آمل')).toBe('ا');
    expect(firstLetter(' اراک')).toBe('ا');
  });
  it('formats Persian numbers', () => {
    expect(faNum(12)).toBe('۱۲');
  });
});
