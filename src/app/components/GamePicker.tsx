import { Suspense, useEffect, useState } from 'react';
import type { AnyGameModule, GameMeta, PlayMode } from '@/core/engine/types';
import { FAMILIES, gamesOf, loadGame, playable } from '@/games/registry';
import { useNum, useT, useTm } from '@/i18n';
import { cn } from '@/ui/cn';
import { Badge, Button, Notice, Sheet } from '@/ui/kit';
import { HowTo } from './HowTo';

export function GameCard({ meta, disabled, onClick, selected }: { meta: GameMeta; disabled?: boolean; onClick?: () => void; selected?: boolean }) {
  const t = useT();
  const num = useNum();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-family={meta.family}
      data-testid={`game-${meta.id}`}
      className={cn(
        'flex min-h-20 w-full items-center gap-3 rounded-2xl border border-border bg-surface p-3 text-start transition active:scale-[.98] disabled:opacity-40',
        selected && 'border-accent ring-2 ring-accent',
      )}
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent/15 text-2xl">{meta.emoji}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-black">{t(`game.${meta.id}.name`)}</span>
        <span className="line-clamp-2 text-xs leading-5 text-muted">{t(`game.${meta.id}.desc`)}</span>
      </span>
      <Badge className="shrink-0">
        {meta.maxPlayers >= 30 ? `${num(meta.minPlayers)}+` : `${num(meta.minPlayers)}–${num(meta.maxPlayers)}`} 👤
      </Badge>
    </button>
  );
}

/** Family → mode browser. Modes that don't fit the current player count are disabled. */
export function GamePicker({ playerCount, mode, onPick, selected }: { playerCount: number; mode: PlayMode; onPick: (id: string) => void; selected?: string | null }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {FAMILIES.map((f) => {
        const games = gamesOf(f.id);
        const isOpen = open === f.id || games.some((g) => g.id === selected);
        return (
          <div key={f.id} data-family={f.id} className="rounded-3xl border border-border bg-surface-2/50 p-2">
            <button
              type="button"
              className="flex h-14 w-full items-center gap-3 px-2 text-start"
              onClick={() => setOpen(isOpen ? '' : f.id)}
              aria-expanded={isOpen}
              data-testid={`family-${f.id}`}
            >
              <span className="text-2xl">{f.emoji}</span>
              <span className="flex-1 text-lg font-black text-accent">{t(`family.${f.id}`)}</span>
              <span className="text-muted">{isOpen ? '▴' : '▾'}</span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-2 p-1">
                {games.map((g) => (
                  <GameCard key={g.id} meta={g} selected={selected === g.id} disabled={!playable(g, playerCount, mode)} onClick={() => onPick(g.id)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Loads a mode and shows its Setup screen + how-to; confirms a validated config. */
export function GameConfigSheet({
  gameId,
  initial,
  playerCount,
  mode,
  onClose,
  onConfirm,
}: {
  gameId: string | null;
  initial?: unknown;
  playerCount: number;
  mode: PlayMode;
  onClose: () => void;
  onConfirm: (gameId: string, config: unknown) => void;
}) {
  const t = useT();
  const tm = useTm();
  const [mod, setMod] = useState<AnyGameModule | null>(null);
  const [config, setConfig] = useState<unknown>(null);
  const [how, setHow] = useState(false);
  useEffect(() => {
    if (!gameId) return;
    let alive = true;
    setMod(null);
    void loadGame(gameId).then((m) => {
      if (!alive) return;
      setMod(m);
      const parsed = m.configSchema.safeParse(initial);
      setConfig(parsed.success ? parsed.data : m.defaultConfig);
    });
    return () => {
      alive = false;
    };
  }, [gameId, initial]);
  const invalid = mod?.validate?.(config as never, playerCount) ?? null;
  const Setup = mod?.screens.Setup;
  return (
    <Sheet open={!!gameId} onClose={onClose} title={gameId ? `${t(`game.${gameId}.name`)}` : ''}>
      {gameId && (
        <div data-family={mod?.family} className="flex flex-col gap-3">
          <p className="text-sm leading-7 text-muted">{t(`game.${gameId}.desc`)}</p>
          <Button variant="secondary" onClick={() => setHow(true)}>
            ❓ {t('how.title')}
          </Button>
          {!mod && <Notice>{t('common.loading')}</Notice>}
          {mod && Setup && (
            <Suspense fallback={null}>
              <Setup config={config as never} onChange={setConfig} playerCount={playerCount} mode={mode} />
            </Suspense>
          )}
          {invalid && <Notice tone="warn">{tm(invalid)}</Notice>}
          <Button size="lg" disabled={!mod} onClick={() => mod && onConfirm(gameId, config)} data-testid="confirm-game">
            {t('lobby.chooseThis')}
          </Button>
          <HowTo gameId={gameId} open={how} onClose={() => setHow(false)} />
        </div>
      )}
    </Sheet>
  );
}
