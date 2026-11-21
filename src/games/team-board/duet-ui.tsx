import { useState } from 'react';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import { PackPicker } from '@/custom/PackPicker';
import { useNum, useT } from '@/i18n';
import { Badge, Button, Card, Notice, Segmented, Stepper, TextField } from '@/ui/kit';
import { WordGrid, type CellColor } from './board-ui';
import { DUET_TURNS, type DuetAction, type DuetConfig, type DuetView } from './duet';

export function DuetSetup({ config, onChange }: SetupProps<DuetConfig>) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label={t('duet.cfg.difficulty')}
        value={config.difficulty}
        onChange={(difficulty) => onChange({ ...config, difficulty })}
        options={(['easy', 'normal', 'hard'] as const).map((d) => ({
          value: d,
          label: t(`duet.diff.${d}`, { n: DUET_TURNS[d] }),
        }))}
      />
      <PackPicker kind="words" value={config.packs} onChange={(packs) => onChange({ ...config, packs })} />
    </div>
  );
}

export function DuetPlay({ view, dispatch, me }: PlayProps<DuetView, DuetAction>) {
  const t = useT();
  const num = useNum();
  const [word, setWord] = useState('');
  const [count, setCount] = useState(1);
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  const amGiver = me === view.giver;
  const amGuesser = !!me && view.seats.includes(me) && !amGiver;
  // revealed: found agents; outline: my key; marks: bystanders seen from each side
  const colors: CellColor[] = view.words.map((_, i) => {
    if (view.found[i]) return 'green';
    if (view.fullKey)
      return view.fullKey[0][i] === 'A' || view.fullKey[1][i] === 'A'
        ? 'black'
        : view.fullKey[0][i] === 'G' || view.fullKey[1][i] === 'G'
          ? 'green'
          : 'neutral';
    const k = view.myKey?.[i];
    return k === 'G' ? 'green' : k === 'A' ? 'black' : null;
  });
  const marks = view.words.map((_, i) => (view.neutral[0][i] || view.neutral[1][i] ? '·' : null));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Badge data-testid="duet-agents">{t('duet.agentsLeft', { n: num(view.agentsLeft) })}</Badge>
        <Badge data-testid="duet-turns">{t('duet.turnsLeft', { n: num(view.turnsLeft) })}</Badge>
        <Badge>{t('duet.giverIs', { name: name(view.giver) })}</Badge>
      </div>
      <p className="text-muted text-xs">{t('duet.legend')}</p>
      {view.clue && (
        <Card className="py-3 text-center text-xl font-black" data-testid="clue">
          «{view.clue.word}» {view.clue.count === 0 ? '∞' : num(view.clue.count)}
        </Card>
      )}
      <WordGrid
        words={view.words}
        revealed={view.found}
        colors={colors}
        marks={marks}
        disabled={!(view.phase === 'guess' && amGuesser)}
        onPick={
          view.phase === 'guess' && amGuesser ? (i) => dispatch({ type: 'reveal', index: i }) : undefined
        }
      />
      {view.phase === 'clue' &&
        (amGiver ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (word.trim()) dispatch({ type: 'clue', word: word.trim(), count });
              setWord('');
            }}
          >
            <TextField
              value={word}
              onChange={(e) => setWord(e.target.value.replace(/\s+/g, ''))}
              placeholder={t('cw.cluePlaceholder')}
              data-testid="duet-clue"
              aria-label={t('cw.cluePlaceholder')}
            />
            <Stepper
              label={t('cw.count')}
              value={count}
              min={0}
              max={9}
              format={(v) => (v === 0 ? '∞' : num(v))}
              onChange={setCount}
            />
            <Button type="submit" size="lg" disabled={!word.trim()} data-testid="duet-send">
              {t('cw.giveClue')}
            </Button>
          </form>
        ) : (
          <Notice>{t('cw.waitClue', { name: name(view.giver) })}</Notice>
        ))}
      {view.phase === 'guess' &&
        (amGuesser ? (
          <Button variant="secondary" onClick={() => dispatch({ type: 'endTurn' })} data-testid="duet-end">
            {t('duet.endTurn')}
          </Button>
        ) : (
          <Notice>{t('duet.partnerGuessing')}</Notice>
        ))}
    </div>
  );
}
