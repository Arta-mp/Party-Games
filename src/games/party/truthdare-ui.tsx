import { m } from 'motion/react';
import { useEffect, useState } from 'react';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import { useT } from '@/i18n';
import { play } from '@/lib/fx';
import { Avatar, Badge, Button, Card, Segmented, Stepper } from '@/ui/kit';
import { LEVELS, type TDAction, type TDConfig, type TDView } from './truthdare';
import { TotalsTable } from './shared-ui';

export function TruthDareSetup({ config, onChange }: SetupProps<TDConfig>) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label={t('td.cfg.level')}
        value={config.level}
        onChange={(level) => onChange({ ...config, level })}
        options={LEVELS.map((l) => ({ value: l, label: t(`td.level.${l}`) }))}
      />
      <Stepper
        label={t('td.cfg.turns')}
        value={config.turns}
        min={2}
        max={60}
        onChange={(turns) => onChange({ ...config, turns })}
      />
    </div>
  );
}

/** Spinner: cycles through names quickly, then lands on the host-chosen player (deterministic per spinId). */
function Spinner({ view }: { view: TDView }) {
  const { current, spinId, players } = view;
  const [shown, setShown] = useState<string | null>(current);
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    if (!current || spinId === 0) return;
    setSpinning(true);
    let i = 0;
    const names = players.map((p) => p.id);
    const id = setInterval(() => {
      setShown(names[i++ % names.length]!);
      play('tick');
    }, 90);
    const stop = setTimeout(() => {
      clearInterval(id);
      setShown(current);
      setSpinning(false);
      play('reveal');
    }, 1300);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [spinId, current, players]);
  const p = view.players.find((x) => x.id === shown);
  return (
    <Card className="flex flex-col items-center gap-3 py-6" data-testid="spinner">
      <m.div
        animate={{ rotate: spinning ? 360 : 0 }}
        transition={{ duration: 0.3, repeat: spinning ? Infinity : 0, ease: 'linear' }}
        className="text-5xl"
      >
        🎡
      </m.div>
      {p ? (
        <div className="flex flex-col items-center gap-2">
          <Avatar name={p.name} size={72} />
          <b className="text-2xl" data-testid="chosen">
            {spinning ? p.name : p.name}
          </b>
        </div>
      ) : null}
    </Card>
  );
}

export function TruthDarePlay({ view, dispatch, me, isHost }: PlayProps<TDView, TDAction>) {
  const t = useT();
  const name = view.players.find((p) => p.id === view.current)?.name ?? '';
  const mine = view.local || me === view.current;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Badge>{t(`td.level.${view.level}`)}</Badge>
        <Badge>{t('td.turn', { n: view.turn + 1, total: view.turns })}</Badge>
      </div>
      <Spinner view={view} />
      {view.phase === 'spin' &&
        (isHost ? (
          <Button size="xl" onClick={() => dispatch({ type: 'spin' })} data-testid="spin">
            🎡 {t('td.spin')}
          </Button>
        ) : (
          <p className="text-muted text-center">{t('td.waitSpin')}</p>
        ))}
      {view.phase === 'choose' &&
        (mine ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="xl"
              variant="secondary"
              onClick={() => dispatch({ type: 'choose', kind: 'truth' })}
              data-testid="truth"
            >
              💬 {t('td.truth')}
            </Button>
            <Button size="xl" onClick={() => dispatch({ type: 'choose', kind: 'dare' })} data-testid="dare">
              🔥 {t('td.dare')}
            </Button>
          </div>
        ) : (
          <p className="text-muted text-center">{t('td.choosing', { name })}</p>
        ))}
      {view.phase === 'task' && (
        <>
          <Card className="border-accent/50 py-6 text-center">
            <Badge className="mb-2">
              {view.kind === 'dare' ? `🔥 ${t('td.dare')}` : `💬 ${t('td.truth')}`}
            </Badge>
            <p className="text-xl leading-9 font-black" data-testid="prompt">
              {view.prompt}
            </p>
          </Card>
          {(isHost || mine) && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="lg"
                variant="success"
                onClick={() => (dispatch({ type: 'done', ok: true }), play('correct'))}
                data-testid="td-done"
              >
                ✅ {t('td.did')}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => dispatch({ type: 'done', ok: false })}
                data-testid="td-skip"
              >
                {t('td.skip')}
              </Button>
            </div>
          )}
        </>
      )}
      <TotalsTable players={view.players} totals={view.points} />
      {isHost && (
        <Button variant="ghost" onClick={() => dispatch({ type: 'end' })}>
          {t('td.end')}
        </Button>
      )}
    </div>
  );
}
