import { useState } from 'react';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import { useNum, useT } from '@/i18n';
import { play } from '@/lib/fx';
import {
  BigWord,
  Button,
  Card,
  HoldReveal,
  Notice,
  PlayerChip,
  PlayerPicker,
  Stepper,
  Timer,
} from '@/ui/kit';
import { PackPicker } from '@/custom/PackPicker';
import type { InsiderAction, InsiderConfig, InsiderView } from './insider';

export function InsiderSetup({ config, onChange }: SetupProps<InsiderConfig>) {
  const t = useT();
  const num = useNum();
  const fmt = (v: number) =>
    t('common.minSec', { m: Math.floor(v / 60), s: num(v % 60).padStart(2, num(0)) });
  return (
    <div className="flex flex-col gap-3">
      <Stepper
        label={t('insider.cfg.search')}
        value={config.searchSeconds}
        min={60}
        max={900}
        step={30}
        format={fmt}
        onChange={(v) => onChange({ ...config, searchSeconds: v })}
      />
      <Stepper
        label={t('insider.cfg.discuss')}
        value={config.discussSeconds}
        min={30}
        max={600}
        step={30}
        format={fmt}
        onChange={(v) => onChange({ ...config, discussSeconds: v })}
      />
      <PackPicker kind="words" value={config.packs} onChange={(packs) => onChange({ ...config, packs })} />
    </div>
  );
}

export function InsiderPlay({ view, dispatch, me, isHost, now }: PlayProps<InsiderView, InsiderAction>) {
  const t = useT();
  const [pick, setPick] = useState<string | null>(null);
  const name = (id: string | null) => view.players.find((p) => p.id === id)?.name ?? '';
  const amGuide = view.me?.role === 'guide';
  const moderator = amGuide || isHost;

  if (view.phase === 'reveal') {
    if (!view.me)
      return <Notice>{t('hw.waitingOthers', { n: view.acked.length, total: view.players.length })}</Notice>;
    const acked = me ? view.acked.includes(me) : false;
    return (
      <div className="flex flex-col gap-4">
        <HoldReveal>
          <div className="flex flex-col items-center gap-2 text-center" data-testid="role-card">
            <span className="text-5xl">
              {view.me.role === 'guide' ? '🧭' : view.me.role === 'insider' ? '🤫' : '🙂'}
            </span>
            <span className="text-2xl font-black" data-testid="role-name">
              {t(`insider.role.${view.me.role}`)}
            </span>
            {view.me.word && (
              <BigWord className="text-accent">
                <span data-testid="secret-word">{view.me.word}</span>
              </BigWord>
            )}
            <p className="text-muted max-w-xs text-xs leading-6">{t(`insider.desc.${view.me.role}`)}</p>
          </div>
        </HoldReveal>
        {acked ? (
          <Notice>{t('hw.waitingOthers', { n: view.acked.length, total: view.players.length })}</Notice>
        ) : (
          <Button size="lg" block onClick={() => dispatch({ type: 'ack' })} data-testid="ack">
            {t('hw.seen')}
          </Button>
        )}
      </div>
    );
  }

  if (view.phase === 'search') {
    return (
      <div className="flex flex-col gap-4">
        <Card className="text-center">
          {t('insider.guideIs')} <b className="text-accent">{name(view.guide)}</b>
          <p className="text-muted mt-1 text-xs">{t('insider.searchHint')}</p>
        </Card>
        {view.endsAt && (
          <Timer
            endsAt={view.endsAt}
            total={Math.round((view.endsAt - now()) / 1000)}
            now={now}
            onTick={(s) => s > 0 && play('tick')}
          />
        )}
        {moderator && (
          <>
            <h2 className="font-black">{t('insider.whoFound')}</h2>
            <PlayerPicker
              players={view.players.filter((p) => p.id !== view.guide)}
              value={pick}
              onChange={setPick}
            />
            <Button
              size="lg"
              disabled={!pick}
              onClick={() =>
                pick && (dispatch({ type: 'found', finder: pick }), setPick(null), play('correct'))
              }
              data-testid="found"
            >
              {t('insider.found')}
            </Button>
          </>
        )}
      </div>
    );
  }

  if (view.phase === 'discuss') {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success">
          {t('insider.wordFound', { word: view.word ?? '', name: name(view.finder) })}
        </Notice>
        {view.endsAt && (
          <Timer endsAt={view.endsAt} total={Math.round((view.endsAt - now()) / 1000)} now={now} />
        )}
        <Card className="text-muted text-center text-sm">{t('insider.discussHint')}</Card>
        {moderator && (
          <Button size="lg" onClick={() => dispatch({ type: 'startVote' })} data-testid="start-vote">
            {t('hw.startVote')}
          </Button>
        )}
      </div>
    );
  }

  if (view.phase === 'vote') {
    const canVote = me && !view.voted.includes(me);
    if (!canVote)
      return (
        <div className="flex flex-col gap-2">
          <Notice>{t('hw.votesIn', { n: view.voted.length, total: view.players.length })}</Notice>
          {view.players.map((p) => (
            <PlayerChip key={p.id} name={p.name} trailing={view.voted.includes(p.id) ? '✅' : '⏳'} />
          ))}
        </div>
      );
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-black">{t('insider.voteWho')}</h2>
        <PlayerPicker
          players={view.players.filter((p) => p.id !== me && p.id !== view.guide)}
          value={pick}
          onChange={setPick}
        />
        <Button
          size="lg"
          disabled={!pick}
          onClick={() => pick && (dispatch({ type: 'vote', target: pick }), setPick(null))}
          data-testid="confirm-vote"
        >
          {t('hw.castVote')}
        </Button>
      </div>
    );
  }
  return <Notice>{t('common.loading')}</Notice>;
}
