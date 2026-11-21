import { useEffect, useRef, useState } from 'react';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import { PackPicker } from '@/custom/PackPicker';
import { useNum, useT } from '@/i18n';
import { Badge, Button, Card, Notice, Segmented, Stepper, TextField } from '@/ui/kit';
import type { SpecAction, SpecConfig, SpecView } from './spectrum';

const BEST_KEY = 'pg:spectrum-best';
/** co-op high score lives on this device only (a per-viewer convenience) */
function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function writeBest(n: number) {
  try {
    localStorage.setItem(BEST_KEY, String(n));
  } catch {
    /* storage blocked */
  }
}

export function SpectrumSetup({ config, onChange }: SetupProps<SpecConfig>) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label={t('spec.cfg.mode')}
        value={config.mode}
        onChange={(mode) => onChange({ ...config, mode })}
        options={[
          { value: 'teams', label: t('spec.mode.teams') },
          { value: 'coop', label: t('spec.mode.coop') },
        ]}
      />
      {config.mode === 'teams' && (
        <Stepper
          label={t('spec.cfg.target')}
          value={config.target}
          min={3}
          max={20}
          onChange={(target) => onChange({ ...config, target })}
        />
      )}
      <Stepper
        label={t('spec.cfg.rounds')}
        value={config.maxRounds}
        min={2}
        max={30}
        onChange={(maxRounds) => onChange({ ...config, maxRounds })}
      />
      <PackPicker
        kind="spectrums"
        value={config.packs}
        onChange={(packs) => onChange({ ...config, packs })}
      />
    </div>
  );
}

/** The spectrum bar. LTR geometry (0 = left end) regardless of page direction. */
function Dial({
  view,
  value,
  onChange,
  editable,
}: {
  view: SpecView;
  value: number;
  onChange?: (v: number) => void;
  editable: boolean;
}) {
  return (
    <div className="flex flex-col gap-2" dir="ltr">
      <div className="flex justify-between text-sm font-black" dir="rtl">
        <span>{view.spectrum.right} ←</span>
        <span>→ {view.spectrum.left}</span>
      </div>
      <div
        className="from-team-b/70 via-surface-2 to-team-a/70 relative h-16 overflow-hidden rounded-2xl bg-gradient-to-r"
        data-testid="dial"
      >
        {view.target != null && (
          <>
            <span
              className="bg-brand/25 absolute inset-y-0"
              style={{ left: `${view.target - 20}%`, width: '40%' }}
            />
            <span
              className="bg-brand/40 absolute inset-y-0"
              style={{ left: `${view.target - 12}%`, width: '24%' }}
            />
            <span
              className="bg-brand absolute inset-y-0"
              style={{ left: `${view.target - 4}%`, width: '8%' }}
              data-testid="target"
            />
          </>
        )}
        <span
          className="absolute inset-y-0 w-1.5 -translate-x-1/2 bg-white shadow"
          style={{ left: `${value}%` }}
        />
        {editable && (
          <input
            type="range"
            min={0}
            max={100}
            value={value}
            aria-label="dial"
            onChange={(e) => onChange?.(Number(e.target.value))}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            data-testid="dial-input"
          />
        )}
      </div>
    </div>
  );
}

export function SpectrumPlay({ view, dispatch, me, isHost }: PlayProps<SpecView, SpecAction>) {
  const t = useT();
  const num = useNum();
  const [clue, setClue] = useState('');
  const [local, setLocal] = useState(view.dial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setLocal(view.dial), [view.dial]);
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  const amPsychic = me === view.psychic;
  const onActive = view.local || (view.myTeam === view.activeTeam && !amPsychic);
  const onOther = view.local || (view.myTeam >= 0 && view.myTeam !== view.activeTeam);
  const setDial = (v: number) => {
    setLocal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => dispatch({ type: 'dial', value: v }), 120); // throttle the shared slider
  };
  const best = readBest();
  if (view.coop && view.phase === 'over' && view.scores[0]! > best) writeBest(view.scores[0]!);
  const scores = view.coop ? (
    <Card className="flex items-center justify-between p-3" data-testid="coop-score">
      <span className="flex flex-col">
        <b>{t('spec.coopScore', { n: view.scores[0] ?? 0, max: view.maxRounds * 4 })}</b>
        <span className="text-muted text-xs">
          {t('spec.coopRound', { n: Math.min(view.round + 1, view.maxRounds), total: view.maxRounds })}
        </span>
      </span>
      {best > 0 && <Badge>🏆 {t('spec.best', { n: best })}</Badge>}
    </Card>
  ) : (
    <div className="grid grid-cols-2 gap-2">
      {view.teams.map((team, i) => (
        <Card key={i} className={`p-3 ${i === view.activeTeam ? 'ring-accent ring-2' : ''}`}>
          <div className="flex justify-between">
            <b>{t('wg.team', { n: i + 1 })}</b>
            <b className="text-xl">
              {num(view.scores[i] ?? 0)}/{num(view.goal)}
            </b>
          </div>
          <span className="text-muted text-xs">{team.map(name).join('، ')}</span>
        </Card>
      ))}
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      {scores}
      <Badge>{t('spec.psychic', { name: name(view.psychic) })}</Badge>
      {view.clue && (
        <Card className="py-3 text-center text-xl font-black" data-testid="spec-clue">
          «{view.clue}»
        </Card>
      )}
      <Dial
        view={view}
        value={view.phase === 'dial' && onActive ? local : view.dial}
        onChange={setDial}
        editable={view.phase === 'dial' && onActive}
      />
      {view.phase === 'clue' &&
        (amPsychic ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (clue.trim()) dispatch({ type: 'clue', text: clue.trim() });
              setClue('');
            }}
          >
            <Notice>{t('spec.psychicHint')}</Notice>
            <TextField
              value={clue}
              onChange={(e) => setClue(e.target.value)}
              placeholder={t('spec.cluePlaceholder')}
              data-testid="spec-clue-input"
              aria-label={t('spec.cluePlaceholder')}
            />
            <Button type="submit" size="lg" disabled={!clue.trim()} data-testid="spec-send">
              {t('cw.giveClue')}
            </Button>
          </form>
        ) : (
          <Notice>{t('cw.waitClue', { name: name(view.psychic) })}</Notice>
        ))}
      {view.phase === 'dial' &&
        (onActive ? (
          <Button size="lg" onClick={() => dispatch({ type: 'lock' })} data-testid="spec-lock">
            🔒 {t('spec.lock')}
          </Button>
        ) : (
          <Notice>{t('spec.teamMoving')}</Notice>
        ))}
      {view.phase === 'counter' &&
        (onOther ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="lg"
              variant="secondary"
              onClick={() => dispatch({ type: 'counter', side: 'right' })}
              data-testid="spec-right"
            >
              {t('spec.moreRight', { s: view.spectrum.right })}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => dispatch({ type: 'counter', side: 'left' })}
              data-testid="spec-left"
            >
              {t('spec.moreLeft', { s: view.spectrum.left })}
            </Button>
          </div>
        ) : (
          <Notice>{t('spec.otherBetting')}</Notice>
        ))}
      {view.phase === 'reveal' && view.last && (
        <>
          <Notice tone="success">
            {t('spec.points', { n: view.last.points })} {view.last.counterOk && t('spec.counterOk')}
          </Notice>
          {(isHost || amPsychic) && (
            <Button size="lg" onClick={() => dispatch({ type: 'next' })} data-testid="spec-next">
              {t('ml.next')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
