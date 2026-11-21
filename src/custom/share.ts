import LZString from 'lz-string';
import { z } from 'zod';
import { packSchema } from '@/content/schema';
import { abilityRoleSchema, infoRoleSchema } from './schemas';

/** §7.4 sharing: JSON → lz-string → `#/import/<code>` link. Everything is re-validated with Zod on import. */
export const sharePayload = z.discriminatedUnion('kind', [
  z.object({ v: z.literal(1), kind: z.literal('pack'), data: packSchema }),
  z.object({ v: z.literal(1), kind: z.literal('info-role'), data: infoRoleSchema }),
  z.object({ v: z.literal(1), kind: z.literal('ability-role'), data: abilityRoleSchema }),
  z.object({
    v: z.literal(1),
    kind: z.literal('bundle'),
    data: z.object({
      packs: z.array(packSchema).default([]),
      infoRoles: z.array(infoRoleSchema).default([]),
      abilityRoles: z.array(abilityRoleSchema).default([]),
    }),
  }),
]);
export type SharePayload = z.infer<typeof sharePayload>;
export type ShareInput = z.input<typeof sharePayload>;

export function encodeShare(p: ShareInput): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(p));
}

export function decodeShare(code: string): SharePayload | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(code.trim());
    if (!json) return null;
    const res = sharePayload.safeParse(JSON.parse(json));
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

/** accepts a share link, a bare code, or raw exported JSON */
export function parseImport(text: string): SharePayload | null {
  const t = text.trim();
  const m = t.match(/#\/import\/([A-Za-z0-9+\-_$]+)/);
  if (m) return decodeShare(m[1]!);
  if (t.startsWith('{')) {
    try {
      const res = sharePayload.safeParse(JSON.parse(t));
      return res.success ? res.data : null;
    } catch {
      return null;
    }
  }
  return decodeShare(t);
}

export function shareLink(p: ShareInput, base = `${location.origin}${location.pathname}`): string {
  return `${base}#/import/${encodeShare(p)}`;
}
