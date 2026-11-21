import { useCallback } from 'react';
import { useSettings, type Lang } from '@/app/settings';
import type { Msg } from '@/core/engine/types';
import { fa } from './fa';
import { en } from './en';

export type TKey = keyof typeof fa;
type Params = Record<string, string | number>;
const DICTS: Record<Lang, Partial<Record<string, string>>> = { fa, en };

const nf: Record<Lang, Intl.NumberFormat> = {
  fa: new Intl.NumberFormat('fa-IR'),
  en: new Intl.NumberFormat('en-US'),
};

export function hasKey(key: string): boolean {
  return key in fa;
}

export function translate(lang: Lang, key: string, params?: Params): string {
  const raw = DICTS[lang][key] ?? fa[key as TKey] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    if (v == null) return `{${name}}`;
    return typeof v === 'number' ? nf[lang].format(v) : v;
  });
}

export function useLang(): Lang {
  return useSettings((s) => s.lang);
}

export type T = (key: string, params?: Params) => string;

export function useT(): T {
  const lang = useLang();
  return useCallback((key: string, params?: Params) => translate(lang, key, params), [lang]);
}

export function useTm(): (m: Msg | null | undefined) => string {
  const t = useT();
  return useCallback((m) => (m ? t(m.k, m.p) : ''), [t]);
}

export function useNum(): (n: number) => string {
  const lang = useLang();
  return useCallback((n: number) => nf[lang].format(n), [lang]);
}
