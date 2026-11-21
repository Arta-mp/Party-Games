import { useState } from 'react';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import { PackPicker } from '@/custom/PackPicker';
import { useNum, useT } from '@/i18n';
import { cn } from '@/ui/cn';
import { Badge, Button, Card, Notice, Stepper, TextField } from '@/ui/kit';
import type { LiarAction, LiarConfig, LiarView } from './liar';
import { TotalsTable } from './shared-ui';

export function LiarSetup({ config, onChange }: SetupProps<LiarConfig>) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <Stepper label={t('ml.cfg.rounds')} value={config.rounds} min={1} max={15} onChange={(rounds) => onChange({ ...config, rounds })} />
      <PackPicker kind="trivia" value={config.packs} onChange={(packs) => onChange({ ...config, packs })} />
    </div>
  );
}

export function LiarPlay({ view, dispatch, me, isHost }: PlayProps<LiarView, LiarAction>) {
  const t = useT();
  const num = useNum();
  const [text, setText] = useState('');
  const [pick, setPick] = useState<number | null>(null);
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  const q = (
    <Card className="flex flex-col gap-2 border-accent/40 py-5 text-center">
      <Badge className="mx-auto">{t('ml.q', { n: view.round + 1, total: view.total })}</Badge>
      <p className="text-xl font-black leading-9" data-testid="liar-question">
        {view.question}
      </p>
    </Card>
  );
  if (view.phase === 'write') {
    return (
      <div className="flex flex-col gap-3">
        {q}
        {me && !view.myLie ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) dispatch({ type: 'lie', text: text.trim() });
              setText('');
            }}
          >
            <TextField value={text} onChange={(e) => setText(e.target.value)} placeholder={t('liar.placeholder')} maxLength={60} data-testid="liar-input" aria-label={t('liar.placeholder')} />
            <Button type="submit" size="lg" disabled={!text.trim()} data-testid="liar-send">
              {t('liar.submit')}
            </Button>
          </form>
        ) : (
          <Notice>{t('hw.waitingOthers', { n: view.written.length, total: view.players.length })}</Notice>
        )}
      </div>
    );
  }
  if (view.phase === 'pick') {
    return (
      <div className="flex flex-col gap-3">
        {q}
        {me && view.myPick == null && view.options ? (
          <>
            <h2 className="font-black">{t('liar.whichTrue')}</h2>
            {view.options.map((o) => (
              <Button key={o.index} variant={pick === o.index ? 'primary' : 'secondary'} size="lg" onClick={() => setPick(o.index)} data-testid={`liar-opt-${o.text}`}>
                {o.text}
              </Button>
            ))}
            <Button size="lg" disabled={pick == null} onClick={() => pick != null && dispatch({ type: 'pick', option: pick })} data-testid="liar-pick">
              {t('common.confirm')}
            </Button>
          </>
        ) : (
          <Notice>{t('hw.votesIn', { n: view.picked.length, total: view.players.length })}</Notice>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {q}
      {view.reveal?.map((o, i) => (
        <Card key={i} className={cn('flex flex-col gap-1 p-3', o.truth && 'border-success bg-success/10')} data-testid={o.truth ? 'liar-truth' : undefined}>
          <b>
            {o.truth ? '✅ ' : '🤥 '}
            {o.text}
          </b>
          <span className="text-xs text-muted">
            {o.truth ? t('liar.truth') : t('liar.by', { names: o.authors.map(name).join('، ') })}
            {o.pickedBy.length > 0 && ` · ${t('liar.pickedBy', { names: o.pickedBy.map(name).join('، ') })}`}
          </span>
        </Card>
      ))}
      <TotalsTable players={view.players} totals={view.scores} />
      {Object.keys(view.lastGain).length > 0 && (
        <p className="text-xs text-muted">
          {Object.entries(view.lastGain)
            .map(([p, n]) => `${name(p)} +${num(n)}`)
            .join(' · ')}
        </p>
      )}
      {isHost && view.phase === 'reveal' && (
        <Button size="lg" onClick={() => dispatch({ type: 'next' })} data-testid="liar-next">
          {t('ml.next')}
        </Button>
      )}
    </div>
  );
}
