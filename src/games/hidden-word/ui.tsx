import { useMemo, useState, type ComponentType } from 'react';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import { useNum, useT, useTm } from '@/i18n';
import { play } from '@/lib/fx';
import { cn } from '@/ui/cn';
import {
  Badge,
  BigWord,
  Button,
  Card,
  HoldReveal,
  Notice,
  PlayerChip,
  PlayerPicker,
  Segmented,
  Sheet,
  Stepper,
  TextField,
  Timer,
  Toggle,
} from '@/ui/kit';
import { PackPicker } from '@/custom/PackPicker';
import { InfoRolePicker } from '@/custom/RolePickers';
import type { HWAction, HWView } from './core';
import { itemsOf } from '@/content/builtin';

type AnyCfg = Record<string, unknown> & { roundSeconds: number; voteMode: 'secret' | 'host' };

export type HWPackKind = 'locations' | 'words' | 'pairs' | 'grids';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeHiddenWordSetup(packKind: HWPackKind): ComponentType<SetupProps<any>> {
  return function Setup(props: SetupProps<AnyCfg>) {
    return <HiddenWordSetup {...props} packKind={packKind} />;
  };
}

export function HiddenWordSetup({
  config,
  onChange,
  packKind,
}: SetupProps<AnyCfg> & { packKind: HWPackKind }) {
  const t = useT();
  const num = useNum();
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch } as AnyCfg);
  const fmtTime = (v: number) =>
    v === 0
      ? t('common.noTimer')
      : t('common.minSec', { m: Math.floor(v / 60), s: num(v % 60).padStart(2, num(0)) });
  const cats = useMemo(
    () =>
      'categories' in config
        ? [
            ...new Set(
              itemsOf('words', undefined)
                .map((w) => w.category)
                .filter(Boolean) as string[],
            ),
          ]
        : [],
    [config],
  );
  return (
    <div className="flex flex-col gap-3">
      <Stepper
        label={t('hw.cfg.roundTime')}
        value={config.roundSeconds}
        min={0}
        max={900}
        step={30}
        onChange={(v) => set({ roundSeconds: v })}
        format={fmtTime}
      />
      <Segmented
        label={t('hw.cfg.voteMode')}
        value={config.voteMode}
        onChange={(v) => set({ voteMode: v })}
        options={[
          { value: 'secret', label: t('hw.cfg.voteSecret') },
          { value: 'host', label: t('hw.cfg.voteHost') },
        ]}
      />
      {'spyCount' in config && (
        <Stepper
          label={t('hw.cfg.spyCount')}
          value={config.spyCount as number}
          min={2}
          max={3}
          onChange={(v) => set({ spyCount: v })}
        />
      )}
      {'spiesKnowEachOther' in config && (
        <Toggle
          label={t('hw.cfg.spiesKnow')}
          checked={config.spiesKnowEachOther as boolean}
          onChange={(v) => set({ spiesKnowEachOther: v })}
        />
      )}
      {'withRoles' in config && (
        <Toggle
          label={t('hw.cfg.withRoles')}
          checked={config.withRoles as boolean}
          onChange={(v) => set({ withRoles: v })}
        />
      )}
      {'infiltrators' in config && (
        <Stepper
          label={t('hw.cfg.infiltrators')}
          value={config.infiltrators as number}
          min={0}
          max={3}
          onChange={(v) => set({ infiltrators: v })}
        />
      )}
      {'blanks' in config && (
        <Stepper
          label={t('hw.cfg.blanks')}
          value={config.blanks as number}
          min={0}
          max={2}
          onChange={(v) => set({ blanks: v })}
        />
      )}
      {'categories' in config && (
        <div className="flex flex-col gap-1.5">
          <span className="text-muted text-sm font-bold">{t('hw.cfg.categories')}</span>
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => {
              const list = config.categories as string[];
              const on = list.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ categories: on ? list.filter((x) => x !== c) : [...list, c] })}
                  className={cn(
                    'h-10 rounded-full border px-3 text-sm font-bold',
                    on ? 'border-accent bg-accent/20' : 'border-border',
                  )}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <span className="text-muted text-xs">{t('hw.cfg.categoriesHint')}</span>
        </div>
      )}
      {'packs' in config && (
        <PackPicker kind={packKind} value={config.packs as never} onChange={(packs) => set({ packs })} />
      )}
      {'extraRoles' in config && packKind !== 'pairs' && (
        <InfoRolePicker value={config.extraRoles as never} onChange={(extraRoles) => set({ extraRoles })} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Play

export function RoleCard({ view }: { view: HWView }) {
  const t = useT();
  const me = view.me;
  if (!me) return null;
  const isSpy = me.team === 'spies' && me.word == null;
  return (
    <div className="flex w-full flex-col items-center gap-2 text-center" data-testid="role-card">
      <span className="text-5xl">{me.emoji}</span>
      {me.roleName && (
        <span className={cn('text-2xl font-black', isSpy && 'text-danger')} data-testid="role-name">
          {me.roleName}
        </span>
      )}
      {me.word ? (
        <>
          <span className="text-muted text-sm">
            {view.grid
              ? t('hw.secretInGrid')
              : me.category
                ? t('hw.yourWordIn', { c: me.category })
                : t('hw.yourWord')}
          </span>
          <BigWord className="text-accent">
            <span data-testid="secret-word">{me.word}</span>
          </BigWord>
          {me.subrole && <Badge className="text-sm">{t('hw.yourRole', { r: me.subrole })}</Badge>}
        </>
      ) : (
        <span className="text-lg font-bold">
          {me.category ? t('hw.onlyCategory', { c: me.category }) : t('hw.noWord')}
        </span>
      )}
      {me.description && <p className="text-muted max-w-xs text-xs leading-6">{me.description}</p>}
      {me.knows.length > 0 && (
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          {me.knows.map((k) => (
            <Badge key={k.id} className="bg-accent/20 text-text">
              {t('hw.knows', { name: view.players.find((p) => p.id === k.id)?.name ?? '', role: k.roleName })}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function Grid({ words, highlight }: { words: string[]; highlight: string | null }) {
  return (
    <div className="grid w-full grid-cols-4 gap-1.5" data-testid="grid16">
      {words.map((w) => (
        <div
          key={w}
          className={cn(
            'bg-surface-2 grid min-h-12 place-items-center rounded-xl p-1 text-center text-xs font-bold',
            highlight === w && 'bg-accent text-accent-ink',
          )}
        >
          {w}
        </div>
      ))}
    </div>
  );
}

export function HiddenWordPlay({ view, dispatch, me, isHost, now, mode }: PlayProps<HWView, HWAction>) {
  const t = useT();
  const tm = useTm();
  const num = useNum();
  const [pick, setPick] = useState<string | null>(null);
  const [guessText, setGuessText] = useState('');
  const [refOpen, setRefOpen] = useState(false);
  const name = (id: string | null) => view.players.find((p) => p.id === id)?.name ?? '';
  const alivePlayers = view.players.filter((p) => view.alive.includes(p.id));

  if (view.phase === 'reveal') {
    if (view.me) {
      const acked = me ? view.acked.includes(me) : false;
      return (
        <div className="flex flex-col gap-4">
          <HoldReveal>
            <RoleCard view={view} />
            {view.grid && <Grid words={view.grid} highlight={view.me.word} />}
          </HoldReveal>
          {acked ? (
            <Notice>{t('hw.waitingOthers', { n: view.acked.length, total: view.players.length })}</Notice>
          ) : (
            <Button size="lg" block onClick={() => dispatch({ type: 'ack' })} data-testid="ack">
              {mode === 'local' ? t('hw.seenPass') : t('hw.seen')}
            </Button>
          )}
        </div>
      );
    }
    return <Notice>{t('hw.waitingOthers', { n: view.acked.length, total: view.players.length })}</Notice>;
  }

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      {view.elimination === 'multi' && <Badge>{t('hw.round', { n: view.round })}</Badge>}
      {view.notice && <Badge className="bg-brand/20 text-text">{tm(view.notice)}</Badge>}
    </div>
  );

  const lastOut = view.lastOut && (
    <Notice tone="warn">
      {t('hw.lastOut', { name: name(view.lastOut.id) })}
      {view.lastOut.roleName && ` — ${view.lastOut.emoji} ${view.lastOut.roleName}`}
    </Notice>
  );

  if (view.phase === 'discuss') {
    return (
      <div className="flex flex-col gap-4">
        {header}
        {lastOut}
        {view.endsAt ? (
          <Timer
            endsAt={view.endsAt}
            total={Math.max(1, Math.round((view.endsAt - now()) / 1000))}
            now={now}
            onTick={(s) => s <= 10 && s > 0 && play('tick')}
          />
        ) : (
          <Card className="text-muted text-center">{t('hw.noTimerDiscuss')}</Card>
        )}
        <Card className="text-center">
          <span className="text-muted">{t('hw.firstAsker')}</span>{' '}
          <b className="text-accent">{name(view.firstAsker)}</b>
          <p className="text-muted mt-1 text-xs">
            {view.elimination === 'multi' ? t('hw.describeHint') : t('hw.askHint')}
          </p>
        </Card>
        {view.me && (
          <HoldReveal className="h-44" label={t('hw.peekRole')}>
            <RoleCard view={view} />
          </HoldReveal>
        )}
        {view.grid && <Grid words={view.grid} highlight={null} />}
        {view.reference && !view.grid && (
          <Button variant="secondary" onClick={() => setRefOpen(true)}>
            {t('hw.referenceList', { n: view.reference.length })}
          </Button>
        )}
        <div className="flex flex-col gap-2">
          {view.me?.canDeclareGuess && (
            <Button
              variant="danger"
              size="lg"
              onClick={() => dispatch({ type: 'declareGuess' })}
              data-testid="declare-guess"
            >
              {t('hw.iKnowIt')}
            </Button>
          )}
          {isHost && (
            <Button size="lg" onClick={() => dispatch({ type: 'startVote' })} data-testid="start-vote">
              {t('hw.startVote')}
            </Button>
          )}
        </div>
        <Sheet open={refOpen} onClose={() => setRefOpen(false)} title={t('hw.referenceTitle')}>
          <div className="grid grid-cols-2 gap-2">
            {view.reference?.map((r) => (
              <span key={r} className="bg-surface-2 rounded-xl px-3 py-2 text-sm">
                {r}
              </span>
            ))}
          </div>
        </Sheet>
      </div>
    );
  }

  if (view.phase === 'vote') {
    if (view.voteMode === 'host') {
      if (!isHost) return <Notice>{t('hw.hostRecordsVote')}</Notice>;
      return (
        <div className="flex flex-col gap-3">
          {header}
          <h2 className="text-xl font-black">{t('hw.whoWasVoted')}</h2>
          <PlayerPicker players={alivePlayers} value={pick} onChange={setPick} />
          <Button
            size="lg"
            disabled={!pick}
            onClick={() => pick && (dispatch({ type: 'hostEliminate', target: pick }), setPick(null))}
            data-testid="confirm-vote"
          >
            {t('hw.eliminate')}
          </Button>
        </div>
      );
    }
    const canVote = me && view.alive.includes(me) && !view.voted.includes(me);
    return (
      <div className="flex flex-col gap-3">
        {header}
        {lastOut}
        {canVote ? (
          <>
            <h2 className="text-xl font-black">{t('hw.voteWho')}</h2>
            <PlayerPicker players={alivePlayers.filter((p) => p.id !== me)} value={pick} onChange={setPick} />
            <Button
              size="lg"
              disabled={!pick}
              onClick={() => pick && (dispatch({ type: 'vote', target: pick }), setPick(null), play('tap'))}
              data-testid="confirm-vote"
            >
              {t('hw.castVote')}
            </Button>
          </>
        ) : (
          <>
            <Notice>{t('hw.votesIn', { n: view.voted.length, total: view.alive.length })}</Notice>
            <div className="flex flex-col gap-2">
              {alivePlayers.map((p) => (
                <PlayerChip key={p.id} name={p.name} trailing={view.voted.includes(p.id) ? '✅' : '⏳'} />
              ))}
            </div>
          </>
        )}
        {view.lastTally && <Tally tally={view.lastTally} name={name} num={num} />}
      </div>
    );
  }

  if (view.phase === 'guess' && view.guess) {
    if (!view.guess.mine)
      return <Notice tone="warn">{t('hw.isGuessing', { name: name(view.guess.guesser) })}</Notice>;
    return (
      <div className="flex flex-col gap-3">
        {lastOut}
        <h2 className="text-xl font-black">{t('hw.yourGuess')}</h2>
        {view.guess.options ? (
          <div className="grid grid-cols-2 gap-2">
            {view.guess.options.map((o) => (
              <Button key={o} variant={pick === o ? 'primary' : 'secondary'} onClick={() => setPick(o)}>
                {o}
              </Button>
            ))}
          </div>
        ) : (
          <TextField
            value={guessText}
            onChange={(e) => setGuessText(e.target.value)}
            placeholder={t('hw.typeGuess')}
            data-testid="guess-input"
          />
        )}
        <Button
          size="lg"
          disabled={!(pick || guessText.trim())}
          onClick={() => dispatch({ type: 'guess', answer: (pick ?? guessText).trim() })}
          data-testid="submit-guess"
        >
          {t('hw.submitGuess')}
        </Button>
      </div>
    );
  }

  if (view.phase === 'witness' && view.witness) {
    if (!view.witness.mine)
      return <Notice tone="warn">{t('hw.findingWitness', { name: name(view.witness.guesser) })}</Notice>;
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-black">{t('hw.whoIsWitness')}</h2>
        <PlayerPicker players={view.players.filter((p) => p.id !== me)} value={pick} onChange={setPick} />
        <Button
          size="lg"
          disabled={!pick}
          onClick={() => pick && dispatch({ type: 'witnessGuess', target: pick })}
        >
          {t('common.confirm')}
        </Button>
      </div>
    );
  }

  return <Notice>{t('common.loading')}</Notice>;
}

function Tally({
  tally,
  name,
  num,
}: {
  tally: Record<string, number>;
  name: (id: string) => string;
  num: (n: number) => string;
}) {
  const max = Math.max(1, ...Object.values(tally));
  return (
    <Card className="flex flex-col gap-2">
      {Object.entries(tally)
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => (
          <div key={id} className="flex items-center gap-2 text-sm">
            <span className="w-24 truncate">{name(id)}</span>
            <span className="bg-accent h-3 rounded-full" style={{ width: `${(n / max) * 60}%` }} />
            <span>{num(n)}</span>
          </div>
        ))}
    </Card>
  );
}
