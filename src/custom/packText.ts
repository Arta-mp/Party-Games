import { packSchema, type Pack, type PackKind } from '@/content/schema';

/**
 * Plain-text format for editing packs on a phone, one item per line:
 *  words:     کلمه | دسته | سختی(۱-۳)
 *  locations: مکان: نقش۱، نقش۲، …
 *  pairs:     کلمه۱ / کلمه۲
 *  grids:     موضوع: ۱۶ کلمه با ، جدا شده
 *  cards:     کلمه: ممنوعه۱، …، ممنوعه۵
 *  spectrums: چپ / راست
 *  questions: سؤال | سطح(family/friends/spicy) | نوع(truth/dare)
 *  trivia:    سؤال | جواب
 *  columns:   نام ستون
 */
export const PACK_KINDS: PackKind[] = ['words', 'locations', 'pairs', 'grids', 'cards', 'spectrums', 'questions', 'trivia', 'columns'];

const split = (s: string, re: RegExp) => s.split(re).map((x) => x.trim()).filter(Boolean);
const digits = (s: string) => s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
const list = /[،,]/;

export function parseLine(kind: PackKind, line: string): unknown {
  const l = line.trim();
  switch (kind) {
    case 'words': {
      const [word, category, diff] = split(l, /\|/);
      const d = diff ? Number(digits(diff)) : undefined;
      return { word, ...(category ? { category } : {}), ...(d ? { difficulty: d } : {}) };
    }
    case 'locations': {
      const [name, rest = ''] = l.split(/[:：]/);
      return { name: name?.trim(), roles: split(rest, list) };
    }
    case 'grids': {
      const [topic, rest = ''] = l.split(/[:：]/);
      return { topic: topic?.trim(), words: split(rest, list) };
    }
    case 'cards': {
      const [word, rest = ''] = l.split(/[:：]/);
      return { word: word?.trim(), forbidden: split(rest, list) };
    }
    case 'pairs': {
      const [a, b] = split(l, /\//);
      return { a, b };
    }
    case 'spectrums': {
      const [left, right] = split(l, /\//);
      return { left, right };
    }
    case 'questions': {
      const [q, level, type] = split(l, /\|/);
      return { q, ...(level ? { level } : {}), ...(type ? { type } : {}) };
    }
    case 'trivia': {
      const [q, answer] = split(l, /\|/);
      return { q, answer };
    }
    case 'columns':
      return { name: l };
  }
}

export function itemToLine(kind: PackKind, item: Record<string, unknown>): string {
  switch (kind) {
    case 'words':
      return [item.word, item.category, item.difficulty].filter((x) => x != null).join(' | ');
    case 'locations':
      return `${item.name}: ${(item.roles as string[]).join('، ')}`;
    case 'grids':
      return `${item.topic}: ${(item.words as string[]).join('، ')}`;
    case 'cards':
      return `${item.word}: ${(item.forbidden as string[]).join('، ')}`;
    case 'pairs':
      return `${item.a} / ${item.b}`;
    case 'spectrums':
      return `${item.left} / ${item.right}`;
    case 'questions':
      return [item.q, item.level, item.type].filter(Boolean).join(' | ');
    case 'trivia':
      return `${item.q} | ${item.answer}`;
    case 'columns':
      return String(item.name);
  }
}

export interface ParseResult {
  pack: Pack | null;
  errors: { line: number; message: string }[];
}

export function parsePackText(meta: { id: string; nameFa: string; kind: PackKind }, text: string): ParseResult {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const items: unknown[] = [];
  const errors: ParseResult['errors'] = [];
  lines.forEach((line, i) => {
    const item = parseLine(meta.kind, line);
    const one = packSchema.safeParse({ ...meta, items: [item] });
    if (one.success) items.push(item);
    else errors.push({ line: i + 1, message: one.error.issues[0]?.path.slice(2).join('.') + ': ' + (one.error.issues[0]?.message ?? '') });
  });
  const res = packSchema.safeParse({ ...meta, items });
  return { pack: res.success && errors.length === 0 ? res.data : null, errors };
}

export function slugId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
