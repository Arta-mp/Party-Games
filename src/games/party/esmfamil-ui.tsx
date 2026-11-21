import { useEffect, useRef, useState } from 'react';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import { useNum, useT } from '@/i18n';
import { play } from '@/lib/fx';
import { cn } from '@/ui/cn';
import { Badge, BigWord, Button, Card, Notice, Stepper, TextField, Timer, Toggle } from '@/ui/kit';
import { defaultColumns, type EsmAction, type EsmConfig, type EsmView } from './esmfamil';
import { TotalsTable } from './shared-ui';

export function EsmFamilSetup({ config, onChange }: SetupProps<EsmConfig>) {
  const t = useT();
  const num = useNum();
  const all = [...new Set([...defaultColumns(), ...config.columns])];
  const [newCol, setNewCol] = useState('');
  const toggle = (c: string) => {
    const on = config.columns.includes(c);
    const next = on ? config.columns.filter((x) => x !== c) : [...config.columns, c];
    if (next.length >= 3 && next.length <= 12) onChange({ ...config, columns: next });
  };
  return (
    <div className="flex flex-col gap-3">
      <Stepper
        label={t('esm.cfg.rounds')}
        value={config.rounds}
        min={1}
        max={10}
        onChange={(rounds) => onChange({ ...config, rounds })}
      />
      <Stepper
        label={t('esm.cfg.time')}
        value={config.roundSeconds}
        min={30}
        max={600}
        step={30}
        format={(v) => t('common.seconds', { n: num(v) })}
        onChange={(roundSeconds) => onChange({ ...config, roundSeconds })}
      />
      <Stepper
        label={t('esm.cfg.grace')}
        value={config.stopGraceSeconds}
        min={0}
        max={30}
        onChange={(stopGraceSeconds) => onChange({ ...config, stopGraceSeconds })}
      />
      <Toggle
        label={t('esm.cfg.hard')}
        hint="ث ذ ژ ص ض ط ظ ع غ"
        checked={config.hardLetters}
        onChange={(hardLetters) => onChange({ ...config, hardLetters })}
      />
      <span className="text-muted text-sm font-bold">{t('esm.cfg.columns')}</span>
      <div className="flex flex-wrap gap-2">
        {all.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={config.columns.includes(c)}
            onClick={() => toggle(c)}
            className={cn(
              'h-10 rounded-full border px-3 text-sm font-bold',
              config.columns.includes(c) ? 'border-accent bg-accent/20' : 'border-border text-muted',
            )}
          >
            {c}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const c = newCol.trim();
          if (!c || config.columns.includes(c) || config.columns.length >= 12) return;
          onChange({ ...config, columns: [...config.columns, c] });
          setNewCol('');
        }}
      >
        <input
          value={newCol}
          onChange={(e) => setNewCol(e.target.value)}
          maxLength={24}
          placeholder={t('esm.cfg.addColumn')}
          aria-label={t('esm.cfg.addColumn')}
          data-testid="esm-new-column"
          className="border-border bg-surface-2 focus:border-accent h-12 min-w-0 flex-1 rounded-2xl border px-3 outline-none"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={!newCol.trim() || config.columns.length >= 12}
          data-testid="esm-add-column"
        >
          +
        </Button>
      </form>
    </div>
  );
}

function Writer({
  view,
  dispatch,
  now,
}: {
  view: EsmView;
  dispatch: (a: EsmAction) => void;
  now: () => number;
}) {
  const t = useT();
  const [answers, setAnswers] = useState<string[]>(() => view.myAnswers ?? view.columns.map(() => ''));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(answers);
  const send = (a: string[]) => dispatch({ type: 'answers', answers: a });
  const update = (i: number, v: string) => {
    const next = answers.map((x, j) => (j === i ? v : x));
    setAnswers(next);
    latest.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => send(next), 350);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (view.local && view.turnEndsAt == null) dispatch({ type: 'startTurn' });
  }, [view.local, view.turnEndsAt, dispatch]);
  const filled = answers.every((a) => a.trim().length > 0);
  const endsAt = view.local ? view.turnEndsAt : view.endsAt;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <Card className="grid size-24 shrink-0 place-items-center p-0">
          <BigWord className="text-accent text-6xl">
            <span data-testid="letter">{view.letter}</span>
          </BigWord>
        </Card>
        <div className="flex-1">
          {endsAt && (
            <Timer
              endsAt={endsAt}
              total={Math.max(1, Math.round((endsAt - now()) / 1000))}
              now={now}
              size={96}
              onTick={(s) => s > 0 && s <= 5 && play('tick')}
            />
          )}
        </div>
      </div>
      {view.stoppedBy && (
        <Notice tone="danger">
          {t('esm.stopped', { name: view.players.find((p) => p.id === view.stoppedBy)?.name ?? '' })}
        </Notice>
      )}
      <Badge>{t('esm.roundOf', { n: view.round, total: view.rounds })}</Badge>
      {view.columns.map((c, i) => (
        <TextField
          key={c}
          label={c}
          value={answers[i] ?? ''}
          onChange={(e) => update(i, e.target.value)}
          onBlur={() => send(latest.current)}
          maxLength={40}
          autoComplete="off"
          data-testid={`answer-${i}`}
        />
      ))}
      <Button
        size="xl"
        variant="danger"
        disabled={!view.local && (!filled || !!view.stoppedBy)}
        onClick={() => {
          send(latest.current);
          dispatch({ type: 'stop' });
          play('buzz');
        }}
        data-testid="stop"
      >
        ✋ {view.local ? t('esm.done') : t('esm.stop')}
      </Button>
    </div>
  );
}

export function EsmFamilPlay({ view, dispatch, me, isHost, now }: PlayProps<EsmView, EsmAction>) {
  const t = useT();
  const num = useNum();
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  const [page, setPage] = useState(0);
  // every new round starts judging from the first column
  const [pageRound, setPageRound] = useState(view.round);
  if (pageRound !== view.round) {
    setPageRound(view.round);
    setPage(0);
  }

  if (view.phase === 'write') {
    if (me && !view.submitted.includes(me))
      return <Writer key={`${view.round}-${me}`} view={view} dispatch={dispatch} now={now} />;
    return (
      <div className="flex flex-col gap-3">
        <Notice>{t('esm.waitWriters', { n: view.submitted.length, total: view.players.length })}</Notice>
        {view.endsAt && (
          <Timer endsAt={view.endsAt} total={Math.round((view.endsAt - now()) / 1000)} now={now} />
        )}
      </div>
    );
  }

  if (!view.board) return null;
  const canReject = (pid: string) => (view.local ? isHost : !!me && me !== pid);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Badge className="text-base">
          {t('esm.letter')}: <b className="text-accent">{view.letter}</b>
        </Badge>
        <Badge>{t('esm.roundOf', { n: view.round, total: view.rounds })}</Badge>
      </div>
      {view.phase === 'judge' && <Notice>{view.local ? t('esm.judgeHintLocal') : t('esm.judgeHint')}</Notice>}
      {view.phase === 'judge' && (
        <div className="flex items-center justify-between" data-testid="esm-pager">
          <Button
            variant="secondary"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            aria-label={t('common.prev')}
          >
            {t('common.prev')}
          </Button>
          <b>{t('esm.columnOf', { n: page + 1, total: view.columns.length })}</b>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= view.columns.length - 1}
            onClick={() => setPage(page + 1)}
            data-testid="esm-next-column"
          >
            {t('common.next')}
          </Button>
        </div>
      )}
      {view.columns.map((c, ci) =>
        view.phase === 'judge' && ci !== page ? null : (
          <Card key={c} className="flex flex-col gap-2 p-3">
            <b className="text-accent">{c}</b>
            {view.board!.map((row) => {
              const ans = row.answers[ci] ?? '';
              const score = view.roundScores?.[row.player]?.[ci];
              return (
                <button
                  key={row.player}
                  type="button"
                  disabled={view.phase !== 'judge' || !canReject(row.player) || !ans.trim()}
                  onClick={() =>
                    dispatch({
                      type: 'reject',
                      player: row.player,
                      col: ci,
                      reject: !row.myRejects[ci] && !(view.local && row.rejectVotes[ci]! > 0),
                    })
                  }
                  className={cn(
                    'flex min-h-11 items-center gap-2 rounded-xl px-3 text-start text-sm',
                    row.valid[ci] ? 'bg-surface-2' : 'bg-danger/10 text-muted line-through',
                    row.myRejects[ci] && 'ring-danger ring-2',
                  )}
                  data-testid={`judge-${name(row.player)}-${ci}`}
                >
                  <span className="text-muted w-16 truncate text-xs no-underline">{name(row.player)}</span>
                  <span className="flex-1 truncate font-bold">{ans || '—'}</span>
                  {row.rejectVotes[ci]! > 0 && !view.local && (
                    <span className="text-danger text-xs">👎{num(row.rejectVotes[ci]!)}</span>
                  )}
                  {score != null && <b className="text-accent no-underline">{num(score)}</b>}
                </button>
              );
            })}
          </Card>
        ),
      )}
      {view.phase === 'judge' && isHost && page === view.columns.length - 1 && (
        <Button size="lg" onClick={() => dispatch({ type: 'finishJudge' })} data-testid="finish-judge">
          {t('esm.score')}
        </Button>
      )}
      {view.phase !== 'judge' && <TotalsTable players={view.players} totals={view.totals} />}
      {view.phase === 'scored' && isHost && (
        <Button size="lg" onClick={() => dispatch({ type: 'nextRound' })} data-testid="next-letter">
          {t('esm.nextRound')}
        </Button>
      )}
    </div>
  );
}
