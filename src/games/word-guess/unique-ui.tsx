import { useState } from 'react';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import { PackPicker } from '@/custom/PackPicker';
import { useT } from '@/i18n';
import { play } from '@/lib/fx';
import { cn } from '@/ui/cn';
import { Badge, BigWord, Button, Card, Notice, Stepper, TextField } from '@/ui/kit';
import type { UniqueAction, UniqueConfig, UniqueView } from './unique';

export function UniqueSetup({ config, onChange }: SetupProps<UniqueConfig>) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <Stepper
        label={t('unique.cfg.rounds')}
        value={config.rounds}
        min={3}
        max={20}
        onChange={(rounds) => onChange({ ...config, rounds })}
      />
      <PackPicker kind="words" value={config.packs} onChange={(packs) => onChange({ ...config, packs })} />
    </div>
  );
}

export function UniquePlay({ view, dispatch, me, isHost }: PlayProps<UniqueView, UniqueAction>) {
  const t = useT();
  const [text, setText] = useState('');
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  const amGuesser = me === view.guesser;
  const header = (
    <div className="flex gap-2">
      <Badge>{t('ml.q', { n: view.round + 1, total: view.total })}</Badge>
      <Badge>{t('unique.score', { n: view.score })}</Badge>
    </div>
  );
  const clueList = view.clues && (
    <div className="flex flex-wrap gap-2" data-testid="clues">
      {view.clues.map((c) => (
        <span
          key={c.p}
          className={cn(
            'rounded-xl px-3 py-2 font-bold',
            c.kept ? 'bg-accent/20' : 'bg-surface-2 text-muted line-through',
          )}
        >
          {c.text}
          {!amGuesser && <span className="text-muted ms-1 text-xs font-normal">({name(c.p)})</span>}
        </span>
      ))}
    </div>
  );

  if (view.phase === 'clues') {
    if (amGuesser || !me) {
      return (
        <div className="flex flex-col gap-3">
          {header}
          <Notice>
            {t('unique.waitClues', {
              name: name(view.guesser),
              n: view.submitted.length,
              total: view.players.length - 1,
            })}
          </Notice>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {header}
        <Card className="flex flex-col items-center gap-2 py-6">
          <span className="text-muted text-sm">{t('unique.wordFor', { name: name(view.guesser) })}</span>
          <BigWord className="text-accent">
            <span data-testid="unique-word">{view.word}</span>
          </BigWord>
        </Card>
        {view.myClue ? (
          <Notice tone="success">{t('unique.yourClue', { c: view.myClue })}</Notice>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) dispatch({ type: 'clue', text: text.trim() });
              setText('');
            }}
          >
            <TextField
              value={text}
              onChange={(e) => setText(e.target.value.replace(/\s+/g, ''))}
              placeholder={t('unique.cluePlaceholder')}
              maxLength={30}
              data-testid="clue-input"
              aria-label={t('unique.cluePlaceholder')}
            />
            <Button type="submit" size="lg" disabled={!text.trim()} data-testid="clue-send">
              {t('common.confirm')}
            </Button>
          </form>
        )}
      </div>
    );
  }

  if (view.phase === 'guess') {
    return (
      <div className="flex flex-col gap-3">
        {header}
        {clueList}
        {view.clues?.every((c) => !c.kept) && amGuesser && (
          <Notice tone="warn">{t('unique.allRemoved')}</Notice>
        )}
        {amGuesser || (isHost && !me) ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              dispatch({ type: 'guess', text: text.trim() });
              setText('');
            }}
          >
            <TextField
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('hw.typeGuess')}
              data-testid="unique-guess"
              aria-label={t('hw.typeGuess')}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button type="submit" size="lg" disabled={!text.trim()} data-testid="unique-guess-send">
                {t('hw.submitGuess')}
              </Button>
              <Button variant="secondary" size="lg" onClick={() => dispatch({ type: 'pass' })}>
                {t('unique.pass')}
              </Button>
            </div>
          </form>
        ) : (
          <Notice>{t('unique.guessing', { name: name(view.guesser) })}</Notice>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {header}
      <Card className="flex flex-col items-center gap-2 py-6 text-center">
        <span className="text-muted text-sm">{t('unique.wordWas')}</span>
        <BigWord>{view.word}</BigWord>
        <p>
          {t('unique.guessed', { name: name(view.guesser), g: view.guess ?? '—' })}{' '}
          {view.correct ? '✅' : '❌'}
        </p>
      </Card>
      {clueList}
      {isHost && !view.correct && view.guess && (
        <Button variant="secondary" onClick={() => (dispatch({ type: 'accept' }), play('correct'))}>
          {t('unique.accept')}
        </Button>
      )}
      {isHost && (
        <Button size="lg" onClick={() => dispatch({ type: 'next' })} data-testid="unique-next">
          {t('ml.next')}
        </Button>
      )}
    </div>
  );
}
