import { useState } from 'react';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import { useT } from '@/i18n';
import { play } from '@/lib/fx';
import { Badge, Button, Card, Notice, PlayerChip, PlayerPicker, Stepper, Toggle } from '@/ui/kit';
import { PackPicker } from '@/custom/PackPicker';
import type { MLAction, MLConfig, MLView } from './mostlikely';
import { TotalsTable, VoteBars } from './shared-ui';

export function MostLikelySetup({ config, onChange }: SetupProps<MLConfig>) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <Stepper
        label={t('ml.cfg.rounds')}
        value={config.rounds}
        min={1}
        max={30}
        onChange={(rounds) => onChange({ ...config, rounds })}
      />
      <Toggle
        label={t('ml.cfg.self')}
        checked={config.allowSelf}
        onChange={(allowSelf) => onChange({ ...config, allowSelf })}
      />
      <PackPicker
        kind="questions"
        value={config.packs}
        onChange={(packs) => onChange({ ...config, packs })}
      />
    </div>
  );
}

export function MostLikelyPlay({ view, dispatch, me, isHost }: PlayProps<MLView, MLAction>) {
  const t = useT();
  const [pick, setPick] = useState<string | null>(null);
  const q = (
    <Card className="border-accent/40 flex flex-col gap-2 py-6 text-center">
      <Badge className="mx-auto">{t('ml.q', { n: view.index + 1, total: view.total })}</Badge>
      <p className="text-2xl leading-10 font-black" data-testid="question">
        {view.question}
      </p>
    </Card>
  );
  if (view.phase === 'vote') {
    const canVote = me && !view.voted.includes(me);
    return (
      <div className="flex flex-col gap-3">
        {q}
        {canVote ? (
          <>
            <PlayerPicker
              players={view.allowSelf ? view.players : view.players.filter((p) => p.id !== me)}
              value={pick}
              onChange={setPick}
            />
            <Button
              size="lg"
              disabled={!pick}
              onClick={() => pick && (dispatch({ type: 'vote', target: pick }), play('tap'))}
              data-testid="confirm-vote"
            >
              {t('hw.castVote')}
            </Button>
          </>
        ) : (
          <>
            <Notice>{t('hw.votesIn', { n: view.voted.length, total: view.players.length })}</Notice>
            {view.players.map((p) => (
              <PlayerChip key={p.id} name={p.name} trailing={view.voted.includes(p.id) ? '✅' : '⏳'} />
            ))}
            {isHost && view.voted.length > 0 && (
              <Button variant="secondary" onClick={() => dispatch({ type: 'reveal' })}>
                {t('ml.revealNow')}
              </Button>
            )}
          </>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {q}
      {view.tally && <VoteBars players={view.players} counts={view.tally} highlight={view.top} />}
      <TotalsTable players={view.players} totals={view.points} />
      {isHost && (
        <Button size="lg" onClick={() => dispatch({ type: 'next' })} data-testid="next-question">
          {view.index + 1 >= view.total ? t('ml.finish') : t('ml.next')}
        </Button>
      )}
    </div>
  );
}
