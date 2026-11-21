import { useState } from 'react';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import { PackPicker } from '@/custom/PackPicker';
import { useNum, useT } from '@/i18n';
import { play } from '@/lib/fx';
import { cn } from '@/ui/cn';
import { Badge, Button, Card, Notice, Stepper, TextField, Timer } from '@/ui/kit';
import { WordGrid } from './board-ui';
import type { CWAction, CWConfig, CWView } from './codewords';

export function CodewordsSetup({ config, onChange }: SetupProps<CWConfig>) {
  const t = useT();
  const num = useNum();
  return (
    <div className="flex flex-col gap-3">
      <Stepper
        label={t('cw.cfg.turn')}
        value={config.turnSeconds}
        min={0}
        max={600}
        step={30}
        format={(v) => (v ? t('common.seconds', { n: num(v) }) : t('common.noTimer'))}
        onChange={(turnSeconds) => onChange({ ...config, turnSeconds })}
      />
      <PackPicker kind="words" value={config.packs} onChange={(packs) => onChange({ ...config, packs })} />
    </div>
  );
}

export function CodewordsPlay({ view, dispatch, me, now }: PlayProps<CWView, CWAction>) {
  const t = useT();
  const num = useNum();
  const [word, setWord] = useState('');
  const [count, setCount] = useState(1);
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  const myTurn = view.myTeam === view.turn;
  const captainNow = view.captains[view.turn];
  const canGuess = view.phase === 'guess' && (view.local ? !view.amCaptain : myTurn && !view.amCaptain);
  const teamLabel = (c: 'red' | 'blue') => (c === 'red' ? `🟥 ${t('cw.red')}` : `🟦 ${t('cw.blue')}`);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {(['red', 'blue'] as const).map((c) => (
          <Card
            key={c}
            className={cn('p-3', view.turn === c && view.phase !== 'over' && 'ring-accent ring-2')}
          >
            <div className="flex items-center justify-between">
              <b>{teamLabel(c)}</b>
              <Badge data-testid={`left-${c}`}>{t('cw.left', { n: num(view.left[c]) })}</Badge>
            </div>
            <p className="text-muted mt-1 text-xs">
              🧠 {name(view.captains[c])} ·{' '}
              {view.teams[c]
                .filter((p) => p !== view.captains[c])
                .map(name)
                .join('، ')}
            </p>
          </Card>
        ))}
      </div>
      {view.myTeam && (
        <p className="text-center text-sm">
          {t('cw.youAre', {
            team: teamLabel(view.myTeam),
            role: view.amCaptain ? t('cw.captain') : t('cw.operative'),
          })}
        </p>
      )}
      {view.clue && view.phase === 'guess' && (
        <Card className="flex items-center justify-center gap-3 py-3 text-xl font-black" data-testid="clue">
          <span>«{view.clue.word}»</span>
          <Badge className="text-lg">{view.clue.count === 0 ? '∞' : num(view.clue.count)}</Badge>
          {view.endsAt && <Timer endsAt={view.endsAt} total={60} now={now} size={56} />}
        </Card>
      )}
      <WordGrid
        words={view.words}
        revealed={view.revealed}
        colors={view.colors}
        disabled={!canGuess}
        onPick={canGuess ? (i) => (dispatch({ type: 'reveal', index: i }), play('tap')) : undefined}
      />
      {view.phase === 'clue' &&
        (view.amCaptain && me === captainNow ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!word.trim()) return;
              dispatch({ type: 'clue', word: word.trim(), count });
              setWord('');
            }}
          >
            <TextField
              value={word}
              onChange={(e) => setWord(e.target.value.replace(/\s+/g, ''))}
              placeholder={t('cw.cluePlaceholder')}
              data-testid="cw-clue"
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
            <Button type="submit" size="lg" disabled={!word.trim()} data-testid="cw-send">
              {t('cw.giveClue')}
            </Button>
          </form>
        ) : (
          <Notice>{t('cw.waitClue', { name: name(captainNow) })}</Notice>
        ))}
      {canGuess && (
        <Button variant="secondary" onClick={() => dispatch({ type: 'endTurn' })} data-testid="cw-end">
          {t('cw.endTurn', { n: num(view.guessesLeft > 20 ? 0 : view.guessesLeft) })}
        </Button>
      )}
      {view.phase === 'guess' && !canGuess && (
        <Notice>{t('cw.teamGuessing', { team: teamLabel(view.turn) })}</Notice>
      )}
      {view.history.length > 0 && (
        <p className="text-muted text-xs">
          {view.history.map((h) => `${h.team === 'red' ? '🟥' : '🟦'} ${h.word} ${h.count}`).join(' · ')}
        </p>
      )}
    </div>
  );
}
