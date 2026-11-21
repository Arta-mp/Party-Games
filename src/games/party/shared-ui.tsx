import type { Player, PlayerId } from '@/core/engine/types';
import { useNum } from '@/i18n';
import { Avatar, Card } from '@/ui/kit';

/** Horizontal bar chart of votes per player (used by «کی احتمالاً» and friends). */
export function VoteBars({
  players,
  counts,
  highlight,
}: {
  players: Player[];
  counts: Record<PlayerId, number>;
  highlight?: PlayerId[];
}) {
  const num = useNum();
  const max = Math.max(1, ...Object.values(counts));
  const rows = [...players]
    .filter((p) => counts[p.id])
    .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
  return (
    <Card className="flex flex-col gap-3" data-testid="vote-bars">
      {rows.map((p) => (
        <div key={p.id} className="flex items-center gap-2">
          <Avatar name={p.name} size={30} />
          <span className="w-20 truncate text-sm font-bold">{p.name}</span>
          <div className="bg-surface-2 h-6 flex-1 overflow-hidden rounded-full">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${highlight?.includes(p.id) ? 'bg-accent' : 'bg-muted/50'}`}
              style={{ width: `${((counts[p.id] ?? 0) / max) * 100}%` }}
            />
          </div>
          <span className="w-6 text-center font-black">{num(counts[p.id] ?? 0)}</span>
        </div>
      ))}
    </Card>
  );
}

export function TotalsTable({ players, totals }: { players: Player[]; totals: Record<PlayerId, number> }) {
  const num = useNum();
  return (
    <Card className="flex flex-col gap-2">
      {[...players]
        .sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0))
        .map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <Avatar name={p.name} size={28} />
            <span className="flex-1 truncate">{p.name}</span>
            <b className="text-accent">{num(totals[p.id] ?? 0)}</b>
          </div>
        ))}
    </Card>
  );
}
