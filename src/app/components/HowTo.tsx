import { useT } from '@/i18n';
import { Sheet } from '@/ui/kit';
import { META, type GameId } from '@/games/meta';

export function HowTo({ gameId, open, onClose }: { gameId: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const meta = META[gameId as GameId];
  return (
    <Sheet open={open} onClose={onClose} title={`${meta?.emoji ?? ''} ${t(`game.${gameId}.name`)} — ${t('how.title')}`}>
      <ol className="flex flex-col gap-3" data-testid="howto">
        {[1, 2, 3].map((i) => (
          <li key={i} className="flex gap-3 rounded-2xl bg-surface-2 p-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent font-black text-accent-ink">{i.toLocaleString('fa-IR')}</span>
            <p className="leading-7">{t(`game.${gameId}.how${i}`)}</p>
          </li>
        ))}
      </ol>
      {meta && (
        <p className="text-sm text-muted">
          {t('how.players', { min: meta.minPlayers, max: meta.maxPlayers })}
        </p>
      )}
    </Sheet>
  );
}
