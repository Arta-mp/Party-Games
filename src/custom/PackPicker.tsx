import { useMemo } from 'react';
import { builtinPacks } from '@/content/builtin';
import type { PackKind, PackSelection } from '@/content/schema';
import { useNum, useT } from '@/i18n';
import { cn } from '@/ui/cn';
import { useCustom } from './store';

/** Choose which built-in and custom packs feed the game. Custom packs are embedded in the config,
 *  so other players never need to install them (§7.4). */
export function PackPicker({
  kind,
  value,
  onChange,
}: {
  kind: PackKind;
  value: PackSelection;
  onChange: (v: PackSelection) => void;
}) {
  const t = useT();
  const num = useNum();
  const builtin = builtinPacks(kind);
  const allCustom = useCustom((s) => s.packs);
  const custom = useMemo(() => allCustom.filter((p) => p.kind === kind), [allCustom, kind]);
  if (builtin.length + custom.length <= 1) return null;
  const allDefault = value.builtin.length === 0 && value.custom.length === 0;
  const builtinOn = (id: string) => allDefault || value.builtin.includes(id);
  const effectiveBuiltin = allDefault ? builtin.map((p) => p.id) : value.builtin;
  const toggleBuiltin = (id: string) => {
    const next = builtinOn(id) ? effectiveBuiltin.filter((x) => x !== id) : [...effectiveBuiltin, id];
    onChange({ builtin: next, custom: value.custom });
  };
  const toggleCustom = (id: string) => {
    const on = value.custom.some((p) => p.id === id);
    const pack = custom.find((p) => p.id === id)!;
    onChange({
      builtin: effectiveBuiltin,
      custom: on ? value.custom.filter((p) => p.id !== id) : [...value.custom, pack],
    });
  };
  const chip = (on: boolean) =>
    cn(
      'h-10 rounded-full border px-3 text-sm font-bold',
      on ? 'border-accent bg-accent/20' : 'border-border text-muted',
    );
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted text-sm font-bold">{t('packs.title')}</span>
      <div className="flex flex-wrap gap-2">
        {builtin.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={builtinOn(p.id)}
            className={chip(builtinOn(p.id))}
            onClick={() => toggleBuiltin(p.id)}
          >
            {p.nameFa} · {num(p.items.length)}
          </button>
        ))}
        {custom.map((p) => {
          const on = value.custom.some((c) => c.id === p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              className={chip(on)}
              onClick={() => toggleCustom(p.id)}
            >
              ✏️ {p.nameFa} · {num(p.items.length)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
