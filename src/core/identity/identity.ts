import { hashString } from '@/core/engine/rng';

/** 2–16 characters, Persian/English letters & digits, single inner spaces/ZWNJ. */
export const NAME_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}‌]| (?! )){0,14}[\p{L}\p{N}]$/u;

export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function validateName(raw: string): 'ok' | 'short' | 'long' | 'chars' {
  const name = cleanName(raw);
  if ([...name].length < 2) return 'short';
  if ([...name].length > 16) return 'long';
  return NAME_RE.test(name) ? 'ok' : 'chars';
}

export function newDeviceId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return 'd' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable avatar colour derived from the name (no photo uploads). */
export function avatarColor(name: string): string {
  const h = hashString(name.trim()) % 360;
  return `hsl(${h} 70% 62%)`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return [...(parts[0] ?? '')][0]?.toUpperCase() ?? '?';
}

/** Makes `name` unique among `taken` by appending a Persian number: «علی ۲». */
export function uniqueName(name: string, taken: string[]): string {
  const set = new Set(taken.map((t) => t.trim()));
  if (!set.has(name)) return name;
  for (let i = 2; i < 100; i++) {
    const candidate = `${name} ${new Intl.NumberFormat('fa-IR').format(i)}`;
    if (!set.has(candidate)) return candidate;
  }
  return `${name} ${Date.now() % 1000}`;
}
