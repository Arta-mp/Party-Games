import { useMemo, type ComponentType } from 'react';
import { itemsOf } from '@/content/builtin';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import { PackPicker } from '@/custom/PackPicker';
import { useNum, useT } from '@/i18n';
import { play } from '@/lib/fx';
import { cn } from '@/ui/cn';
import { Avatar, Badge, BigWord, Button, Card, Notice, Segmented, Stepper, Timer, Toggle } from '@/ui/kit';
import type { WGAction, WGView } from './core';
import { useTilt } from './tilt';

const TEAM_COLORS = ['bg-team-a', 'bg-team-b', 'bg-success', 'bg-brand'];

type Cfg = {
  targetScore: number;
  manualTeams: Record<string, number>;
  teams: number;
  turnSeconds: number;
  rounds: number;
  skipPenalty: boolean;
  categories?: string[];
  difficulty?: number;
  packs: never;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeWGSetup(id: string): ComponentType<SetupProps<any>> {
  return function WGSetup({ config, onChange, players }: SetupProps<Cfg>) {
    const t = useT();
    const num = useNum();
    const set = (p: Partial<Cfg>) => onChange({ ...config, ...p });
    const cats = useMemo(
      () => [
        ...new Set(
          itemsOf('words', config.packs)
            .map((w) => w.category)
            .filter(Boolean) as string[],
        ),
      ],
      [config.packs],
    );
    return (
      <div className="flex flex-col gap-3">
        <Stepper
          label={t('wg.cfg.teams')}
          value={config.teams}
          min={id === 'word.forehead' ? 0 : 2}
          max={4}
          format={(v) => (v === 0 ? t('wg.cfg.solo') : num(v))}
          onChange={(teams) => set({ teams })}
        />
        <Stepper
          label={t('wg.cfg.turn')}
          value={config.turnSeconds}
          min={20}
          max={300}
          step={10}
          format={(v) => t('common.seconds', { n: num(v) })}
          onChange={(turnSeconds) => set({ turnSeconds })}
        />
        <Stepper
          label={t('wg.cfg.target')}
          value={config.targetScore}
          min={0}
          max={200}
          step={5}
          format={(v) => (v === 0 ? t('wg.cfg.noTarget') : num(v))}
          onChange={(targetScore) => set({ targetScore })}
        />
        {config.targetScore === 0 && (
          <Stepper
            label={t('wg.cfg.rounds')}
            value={config.rounds}
            min={1}
            max={5}
            onChange={(rounds) => set({ rounds })}
          />
        )}
        {config.teams > 0 && players && players.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="team-assign">
            <span className="text-muted text-sm font-bold">{t('wg.cfg.assign')}</span>
            {players.map((p) => {
              const cur = config.manualTeams[p.id];
              return (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-bold">{p.name}</span>
                  <div
                    className="bg-surface-2 flex gap-1 rounded-xl p-1"
                    role="radiogroup"
                    aria-label={p.name}
                  >
                    {[-1, ...Array.from({ length: config.teams }, (_, i) => i)].map((ti) => (
                      <button
                        key={ti}
                        type="button"
                        role="radio"
                        aria-checked={(cur ?? -1) === ti}
                        data-testid={`team-${p.name}-${ti}`}
                        onClick={() => {
                          const next = { ...config.manualTeams };
                          if (ti < 0) delete next[p.id];
                          else next[p.id] = ti;
                          set({ manualTeams: next });
                        }}
                        className={cn(
                          'h-10 min-w-10 rounded-lg px-2 text-sm font-bold',
                          (cur ?? -1) === ti
                            ? ti < 0
                              ? 'bg-border'
                              : cn(TEAM_COLORS[ti % 4], 'text-white')
                            : 'text-muted',
                        )}
                      >
                        {ti < 0 ? '🎲' : num(ti + 1)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <span className="text-muted text-xs">{t('wg.cfg.assignHint')}</span>
          </div>
        )}
        <Toggle
          label={t('wg.cfg.skipPenalty')}
          checked={config.skipPenalty}
          onChange={(skipPenalty) => set({ skipPenalty })}
        />
        {config.difficulty != null && (
          <Segmented
            label={t('wg.cfg.difficulty')}
            value={String(config.difficulty)}
            onChange={(v) => set({ difficulty: Number(v) })}
            options={[0, 1, 2, 3].map((d) => ({ value: String(d), label: t(`wg.diff.${d}`) }))}
          />
        )}
        {config.categories && (
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => {
              const on = config.categories!.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    set({
                      categories: on ? config.categories!.filter((x) => x !== c) : [...config.categories!, c],
                    })
                  }
                  className={cn(
                    'h-10 rounded-full border px-3 text-sm font-bold',
                    on ? 'border-accent bg-accent/20' : 'border-border text-muted',
                  )}
                >
                  {c}
                </button>
              );
            })}
          </div>
        )}
        <PackPicker
          kind={id === 'word.forbidden' ? 'cards' : 'words'}
          value={config.packs}
          onChange={(packs) => set({ packs: packs as never })}
        />
      </div>
    );
  };
}

export function Teams({ view }: { view: WGView }) {
  const t = useT();
  const num = useNum();
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  const solo = view.teams.every((x) => x.length === 1);
  return (
    <div
      className={cn(
        'grid gap-2',
        solo ? 'grid-cols-2' : view.teams.length > 2 ? 'grid-cols-2' : 'grid-cols-2',
      )}
      data-testid="teams"
    >
      {view.teams.map((team, i) => (
        <Card
          key={i}
          className={cn(
            'flex flex-col gap-1 p-3',
            i === view.performerTeam && view.phase !== 'over' && 'ring-accent ring-2',
          )}
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-black">
              <span className={cn('size-3 rounded-full', TEAM_COLORS[i % 4])} />
              {solo ? name(team[0]!) : t('wg.team', { n: i + 1 })}
            </span>
            <b className="text-xl" data-testid={`score-${i}`}>
              {num(view.scores[i] ?? 0)}
            </b>
          </div>
          {!solo && <span className="text-muted text-xs">{team.map(name).join('، ')}</span>}
        </Card>
      ))}
    </div>
  );
}

export function WordGuessPlay({ view, dispatch, me, isHost, now }: PlayProps<WGView, WGAction>) {
  const t = useT();
  const num = useNum();
  const performerName = view.players.find((p) => p.id === view.performer)?.name ?? '';
  const amPerformer = me === view.performer || (view.local && me === view.performer);
  const canControl = amPerformer || (view.local && view.mode === 'word.forehead');
  const correct = () => (dispatch({ type: 'correct' }), play('correct'));
  const skip = () => (dispatch({ type: 'skip' }), play('wrong'));
  const tilt = useTilt(view.mode === 'word.forehead' && view.phase === 'turn' && canControl, correct, skip);

  if (view.phase === 'ready') {
    return (
      <div className="flex flex-col gap-4">
        <Teams view={view} />
        <Card className="flex flex-col items-center gap-3 py-6 text-center">
          <Badge>
            {view.targetScore > 0
              ? t('wg.toTarget', { n: view.targetScore })
              : t('wg.turnOf', { n: view.turn + 1, total: view.totalTurns })}
          </Badge>
          <Avatar name={performerName} size={72} />
          <h2 className="text-2xl font-black">
            {t(view.mode === 'word.forehead' ? 'wg.guesser' : 'wg.performer', { name: performerName })}
          </h2>
          <p className="text-muted text-sm">{t(`wg.readyHint.${view.mode}`)}</p>
        </Card>
        {(amPerformer || isHost) && (
          <Button size="xl" onClick={() => dispatch({ type: 'start' })} data-testid="wg-start">
            ▶ {t('wg.go')}
          </Button>
        )}
        {view.mode === 'word.forehead' && tilt.needsButton && (
          <Button variant="secondary" onClick={() => void tilt.request()}>
            📱 {t('wg.enableTilt')}
          </Button>
        )}
      </div>
    );
  }

  if (view.phase === 'turn') {
    const opponent = !amPerformer && view.myTeam >= 0 && view.myTeam !== view.performerTeam;
    return (
      <div className="flex flex-col gap-3">
        {view.endsAt && (
          <Timer
            endsAt={view.endsAt}
            total={view.turnSeconds}
            now={now}
            size={130}
            onTick={(s) => s > 0 && play('tick')}
          />
        )}
        {view.card ? (
          <Card
            className={cn(
              'border-accent flex flex-col items-center gap-3 border-2 py-8',
              view.mode === 'word.forehead' && 'py-14',
            )}
            data-testid="wg-card"
          >
            {view.card.category && <Badge>{view.card.category}</Badge>}
            <BigWord className={view.mode === 'word.forehead' ? 'text-6xl' : ''}>
              <span data-testid="wg-word">{view.card.word}</span>
            </BigWord>
            {view.card.extra.length > 0 && (
              <div className="border-border flex flex-col items-center gap-1 border-t pt-3">
                <span className="text-danger text-xs">{t('wg.forbidden')}</span>
                {view.card.extra.map((x) => (
                  <span key={x} className="text-muted font-bold">
                    {x}
                  </span>
                ))}
              </div>
            )}
          </Card>
        ) : (
          <Card className="py-10 text-center text-2xl font-black">
            🤔 {t('wg.guessNow', { name: performerName })}
          </Card>
        )}
        {canControl && (
          <div className="grid grid-cols-2 gap-2">
            <Button size="xl" variant="secondary" onClick={skip} data-testid="wg-skip">
              ⏭ {t('wg.skip')}
            </Button>
            <Button size="xl" variant="success" onClick={correct} data-testid="wg-correct">
              ✅ {t('wg.correct')}
            </Button>
          </div>
        )}
        {view.allowBuzz && (opponent || view.local) && (
          <Button
            size="xl"
            variant="danger"
            onClick={() => (dispatch({ type: 'buzz' }), play('buzz'))}
            data-testid="wg-buzz"
          >
            📢 {t('wg.buzz')}
          </Button>
        )}
        {view.mode === 'word.forehead' && canControl && (
          <p className="text-muted text-center text-xs">{t('wg.tiltHint')}</p>
        )}
        <Teams view={view} />
      </div>
    );
  }

  // turn end
  return (
    <div className="flex flex-col gap-3">
      <Notice>{t('wg.timeUp', { name: performerName })}</Notice>
      <Card className="flex flex-col gap-1" data-testid="wg-log">
        {view.log.length === 0 && <span className="text-muted">—</span>}
        {view.log.map((l, i) => (
          <span
            key={i}
            className={cn(
              'flex justify-between',
              l.result === 'correct' ? 'text-success' : 'text-muted line-through',
            )}
          >
            {l.word}
            <span>{l.result === 'correct' ? '✅' : l.result === 'buzz' ? '📢' : '⏭'}</span>
          </span>
        ))}
        <b className="mt-1">
          {t('wg.turnPoints', { n: num(view.log.filter((l) => l.result === 'correct').length) })}
        </b>
      </Card>
      <Teams view={view} />
      {(amPerformer || isHost) && (
        <Button size="lg" onClick={() => dispatch({ type: 'next' })} data-testid="wg-next">
          {t('wg.nextTurn')}
        </Button>
      )}
      {isHost && (
        <Button variant="ghost" onClick={() => dispatch({ type: 'end' })}>
          {t('td.end')}
        </Button>
      )}
    </div>
  );
}
