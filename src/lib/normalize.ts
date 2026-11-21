/**
 * Normalises Persian/Arabic text for comparisons (اسم فامیل، سرنخ یکتا، حدس کلمه):
 * ي→ی، ك→ک، ة→ه، أإآ→ا، ؤ→و، removes diacritics (اعراب)، tatweel، ZWNJ/نیم‌فاصله and extra spaces,
 * converts Persian/Arabic digits to Latin and lowercases Latin letters.
 */
const MAP: Record<string, string> = {
  ي: 'ی',
  ى: 'ی',
  ئ: 'ی',
  ك: 'ک',
  ة: 'ه',
  ۀ: 'ه',
  أ: 'ا',
  إ: 'ا',
  آ: 'ا',
  ٱ: 'ا',
  ؤ: 'و',
};

const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const INVISIBLES = /[\u200C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u0640]|\u200D/g; // ZWNJ, ZWJ, bidi marks, BOM, tatweel
const PUNCT = /[.,،؛;:!?؟"'«»()[\]{}\-_/\\]/g;

export function normalizeFa(input: string): string {
  let s = input.normalize('NFC').replace(DIACRITICS, '').replace(INVISIBLES, '');
  s = s.replace(/[يىئكةۀأإآٱؤ]/g, (ch) => MAP[ch] ?? ch);
  s = s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(PUNCT, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return s;
}

/** Same as normalizeFa but also ignores all spaces ("نیم فاصله"/"نیم‌فاصله"/"نیمفاصله" are equal). */
export function compactFa(input: string): string {
  return normalizeFa(input).replace(/\s/g, '');
}

export function sameAnswer(a: string, b: string): boolean {
  const x = compactFa(a);
  return x.length > 0 && x === compactFa(b);
}

/** first letter used by اسم فامیل (after normalisation; آ counts as ا) */
export function firstLetter(input: string): string {
  return compactFa(input).charAt(0);
}

const faDigits = new Intl.NumberFormat('fa-IR', { useGrouping: false });
export function faNum(n: number): string {
  return faDigits.format(n);
}
