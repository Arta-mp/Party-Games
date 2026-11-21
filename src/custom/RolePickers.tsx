import { WITNESS } from '@/games/hidden-word/core';
import { useT } from '@/i18n';
import { Stepper } from '@/ui/kit';
import type { InfoRole } from './schemas';
import { useCustom } from './store';

/** Adds custom information roles (§7.2) to a hidden-word game. */
export function InfoRolePicker({
  value,
  onChange,
}: {
  value: { role: InfoRole; n: number }[];
  onChange: (v: { role: InfoRole; n: number }[]) => void;
}) {
  const t = useT();
  const saved = useCustom((s) => s.infoRoles);
  const roles = [WITNESS, ...saved.filter((r) => r.id !== WITNESS.id)];
  const countOf = (id: string) => value.find((v) => v.role.id === id)?.n ?? 0;
  const setCount = (role: InfoRole, n: number) => {
    const rest = value.filter((v) => v.role.id !== role.id);
    onChange(n > 0 ? [...rest, { role, n }] : rest);
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold text-muted">{t('roles.extraInfo')}</span>
      {roles.map((r) => (
        <Stepper key={r.id} label={`${r.emoji} ${r.nameFa}`} value={countOf(r.id)} min={0} max={Math.max(1, r.count.max)} onChange={(n) => setCount(r, n)} />
      ))}
    </div>
  );
}
