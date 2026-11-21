import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnyGameModule, Player, PlayerId } from '@/core/engine/types';
import { useT } from '@/i18n';
import { play } from '@/lib/fx';
import { useWakeLock } from '@/lib/hooks';
import { Button, Handoff, Notice, PlayerPicker, Sheet } from '@/ui/kit';
import { useLocal } from '../local';

/**
 * Pass & Play stage. Whoever is in `pending()` gets the phone privately (hand-off screen first);
 * otherwise the shared public view is shown and the table can drive host actions.
 */
export function LocalStage() {
  const t = useT();
  const { runner, module, act, tick } = useLocal();
  useLocal((s) => s.rev); // re-render on every change
  const [confirmed, setConfirmed] = useState<PlayerId | null>(null);
  const [peek, setPeek] = useState<PlayerId | null>(null);
  const [peekPick, setPeekPick] = useState<PlayerId | null>(null);
  const [peekOpen, setPeekOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useWakeLock(true);

  useEffect(() => {
    const id = setInterval(() => tick(Date.now()), 250);
    return () => clearInterval(id);
  }, [tick]);

  const pending = runner?.pending() ?? [];
  const privateFor = peek ?? pending[0] ?? null;
  // whenever the shared screen is shown, the next private view needs a fresh hand-off
  useEffect(() => {
    if (!privateFor) setConfirmed(null);
  }, [privateFor]);

  if (!runner || !module) return null;
  const players = runner.players;
  const name = (id: PlayerId) => players.find((p) => p.id === id)?.name ?? '';
  const Play = module.screens.Play;

  const dispatch = (actor: PlayerId) => (a: unknown) => {
    const err = act(actor, a);
    setError(err);
    if (err) play('wrong');
  };

  if (privateFor && confirmed !== privateFor) {
    return (
      <Handoff
        name={name(privateFor)}
        reason={peek ? t('pp.peekReason') : undefined}
        onReady={() => {
          play('reveal');
          setConfirmed(privateFor);
        }}
      />
    );
  }

  if (privateFor) {
    return (
      <div className="flex flex-col gap-3" data-testid="private-view">
        <Notice>{t('pp.onlyYou', { name: name(privateFor) })}</Notice>
        <Play
          view={runner.viewFor(privateFor) as never}
          dispatch={dispatch(privateFor)}
          me={privateFor}
          isHost={false}
          players={players}
          mode="local"
          now={Date.now}
        />
        {error && <Notice tone="danger">{t(`err.${error}`)}</Notice>}
        {peek && (
          <Button
            variant="secondary"
            onClick={() => {
              setPeek(null);
              setConfirmed(null);
            }}
            data-testid="peek-done"
          >
            {t('pp.hideAndReturn')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="public-view">
      <Play
        view={runner.viewFor('public') as never}
        dispatch={dispatch(runner.hostId)}
        me={null}
        isHost
        players={players}
        mode="local"
        now={Date.now}
      />
      {error && <Notice tone="danger">{t(`err.${error}`)}</Notice>}
      <Button variant="ghost" onClick={() => setPeekOpen(true)} data-testid="peek">
        👁️ {t('pp.peek')}
      </Button>
      <Sheet open={peekOpen} onClose={() => setPeekOpen(false)} title={t('pp.peekTitle')}>
        <PlayerPicker players={players} value={peekPick} onChange={setPeekPick} />
        <Button
          disabled={!peekPick}
          onClick={() => {
            setPeek(peekPick);
            setConfirmed(null);
            setPeekOpen(false);
            setPeekPick(null);
          }}
        >
          {t('common.confirm')}
        </Button>
      </Sheet>
    </div>
  );
}

/** Online stage: render my own view as received from the host. */
export function OnlineStage({
  module,
  view,
  me,
  isHost,
  players,
  dispatch,
  now,
  lastError,
}: {
  module: AnyGameModule;
  view: unknown;
  me: PlayerId;
  isHost: boolean;
  players: Player[];
  dispatch: (a: unknown) => void;
  now: () => number;
  lastError: string | null;
}) {
  const t = useT();
  useWakeLock(true);
  const Play = module.screens.Play;
  const lastErr = useRef(lastError);
  useEffect(() => {
    if (lastError && lastError !== lastErr.current) play('wrong');
    lastErr.current = lastError;
  }, [lastError]);
  const stableNow = useMemo(() => now, [now]);
  if (!view) return <Notice>{t('common.loading')}</Notice>;
  return (
    <div className="flex flex-col gap-3">
      <Play view={view as never} dispatch={dispatch} me={me} isHost={isHost} players={players} mode="online" now={stableNow} />
    </div>
  );
}
