import { useEffect, useState } from 'react';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import { useNum, useT, useTm } from '@/i18n';
import { play } from '@/lib/fx';
import { cn } from '@/ui/cn';
import { Avatar, Badge, Button, Card, Notice, Segmented, Stepper, Timer } from '@/ui/kit';
import type { HoldemAction, HoldemConfig, HoldemView } from './holdem';
import { isRed, rankOf, RANKS, SUITS, suitOf, type CardId } from './poker';

// ------------------------------------------------------------------ setup

export function HoldemSetup({ config, onChange }: SetupProps<HoldemConfig>) {
  const t = useT();
  const num = useNum();
  const set = (p: Partial<HoldemConfig>) => onChange({ ...config, ...p });
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label={t('poker.cfg.cards')}
        value={config.cards}
        onChange={(cards) => set({ cards })}
        options={[
          { value: 'virtual', label: `📱 ${t('poker.cfg.virtual')}` },
          { value: 'physical', label: `🃏 ${t('poker.cfg.physical')}` },
        ]}
      />
      <p className="text-muted text-xs leading-6">
        {config.cards === 'virtual' ? t('poker.cfg.virtualHint') : t('poker.cfg.physicalHint')}
      </p>
      <Stepper
        label={t('poker.cfg.stack')}
        value={config.startingStack}
        min={100}
        max={100_000}
        step={100}
        onChange={(startingStack) => set({ startingStack })}
      />
      <Stepper
        label={t('poker.cfg.blinds')}
        value={config.smallBlind}
        min={1}
        max={Math.max(1, Math.floor(config.startingStack / 10))}
        step={config.smallBlind >= 50 ? 10 : config.smallBlind >= 10 ? 5 : 1}
        format={(v) => `${num(v)}/${num(v * 2)}`}
        onChange={(smallBlind) => set({ smallBlind })}
      />
      <Stepper
        label={t('poker.cfg.levels')}
        value={config.blindLevelHands}
        min={0}
        max={50}
        format={(v) => (v === 0 ? t('poker.cfg.never') : t('poker.cfg.everyN', { n: num(v) }))}
        onChange={(blindLevelHands) => set({ blindLevelHands })}
      />
      <Stepper
        label={t('poker.cfg.clock')}
        value={config.actionSeconds}
        min={0}
        max={120}
        step={5}
        format={(v) => (v ? t('common.seconds', { n: num(v) }) : t('common.noTimer'))}
        onChange={(actionSeconds) => set({ actionSeconds })}
      />
    </div>
  );
}

// ------------------------------------------------------------------ cards

export function PlayingCard({
  card,
  size = 'md',
  hidden,
}: {
  card: CardId | null;
  size?: 'sm' | 'md' | 'lg';
  hidden?: boolean;
}) {
  const dims = { sm: 'h-11 w-8 text-xs', md: 'h-16 w-11 text-base', lg: 'h-28 w-20 text-2xl' }[size];
  if (card == null)
    return <span className={cn('rounded-lg border-2 border-dashed border-white/25', dims)} aria-hidden />;
  if (hidden)
    return (
      <span
        className={cn(
          'rounded-lg border-2 border-white/80 bg-[repeating-linear-gradient(45deg,#7c3aed_0_6px,#5b21b6_6px_12px)] shadow-md',
          dims,
        )}
        aria-label="card"
      />
    );
  const red = isRed(card);
  const rank = RANKS[rankOf(card)];
  const suit = SUITS[suitOf(card)];
  return (
    <span
      className={cn(
        'ltr animate-pop relative flex flex-col justify-between rounded-lg bg-white p-1 leading-none font-black shadow-md',
        red ? 'text-[#d61f3c]' : 'text-[#111]',
        dims,
      )}
      aria-label={`${rank}${suit}`}
      data-testid="playing-card"
    >
      <span className="self-start">{rank}</span>
      <span className={cn('self-center', size === 'lg' ? 'text-4xl' : size === 'md' ? 'text-xl' : 'text-sm')}>
        {suit}
      </span>
      <span className="rotate-180 self-end">{rank}</span>
    </span>
  );
}

function Chips({ n, className }: { n: number; className?: string }) {
  const num = useNum();
  return (
    <span className={cn('inline-flex items-center gap-1 font-black tabular-nums', className)}>
      <span
        aria-hidden
        className="inline-block size-3.5 rounded-full border-2 border-dashed border-white bg-[#e6b54a]"
      />
      {num(n)}
    </span>
  );
}

// ------------------------------------------------------------------ play

export function HoldemPlay({ view, dispatch, me, isHost, now }: PlayProps<HoldemView, HoldemAction>) {
  const t = useT();
  const tm = useTm();
  const num = useNum();
  const [showHole, setShowHole] = useState(true);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [picks, setPicks] = useState<string[]>([]);
  const legal = view.me?.legal ?? null;
  const myTurn = !!legal;
  const name = (id: string | null) => view.seats.find((s) => s.id === id)?.name ?? '';
  const seat = view.seats.find((s) => s.id === me);
  // whoever has to act right now (in pass & play with physical cards that's not `me`)
  const actor = view.seats.find((s) => s.id === view.toAct);

  useEffect(() => {
    if (legal) setRaiseTo(legal.minRaiseTo);
    setRaiseOpen(false);
    // a fresh decision every time the turn comes back
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.toAct, view.currentBet, view.street, view.hand]);
  useEffect(() => {
    if (myTurn) play('tap');
  }, [myTurn]);

  const send = (a: HoldemAction, sfx: Parameters<typeof play>[0] = 'tap') => {
    dispatch(a);
    play(sfx);
    setRaiseOpen(false);
  };

  // pot-size presets: raise to currentBet + fraction × (pot after calling)
  const potAfterCall = view.pot + (legal?.toCall ?? 0);
  const preset = (f: number) =>
    legal
      ? Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(view.currentBet + f * potAfterCall)))
      : 0;
  const boardSlots = [0, 1, 2, 3, 4].map((i) => view.board[i] ?? null);
  const streetBadge = t(`poker.street.${view.street}`);

  // ---------------------------------------------------------------- table
  const table = (
    <div
      className="relative flex flex-col items-center gap-3 rounded-[2.5rem] border-[6px] border-[#4a2e12] bg-[radial-gradient(ellipse_at_center,#1f8a4c_0%,#0f5c31_70%,#0b4426_100%)] px-3 py-5 text-white shadow-[inset_0_0_30px_rgba(0,0,0,.45)]"
      data-testid="poker-table"
    >
      <div className="flex w-full items-center justify-between text-xs font-bold">
        <span className="rounded-full bg-black/30 px-2 py-1">{t('poker.handN', { n: view.hand })}</span>
        <span className="rounded-full bg-black/30 px-2 py-1">
          {t('poker.blindsLabel', { sb: view.sb, bb: view.bb })}
          {view.nextLevelIn != null && ` · ${t('poker.levelIn', { n: view.nextLevelIn })}`}
        </span>
      </div>
      {view.mode === 'virtual' ? (
        <div className="flex gap-1.5" data-testid="board">
          {boardSlots.map((c, i) => (
            <PlayingCard key={i} card={c} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1 py-2 text-center" data-testid="board">
          <span className="flex gap-1.5" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <PlayingCard
                key={i}
                card={i < { preflop: 0, flop: 3, turn: 4, river: 5 }[view.street] ? 0 : null}
                hidden
                size="sm"
              />
            ))}
          </span>
          <span className="text-sm font-bold">{t(`poker.physicalStreet.${view.street}`)}</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Badge className="bg-black/35 text-white">{streetBadge}</Badge>
        <span className="rounded-full bg-black/40 px-3 py-1 text-lg" data-testid="pot">
          {t('poker.pot')} <Chips n={view.pot} />
        </span>
      </div>
    </div>
  );

  // ---------------------------------------------------------------- seats
  const seats = (
    <div className="grid grid-cols-2 gap-2" data-testid="seats">
      {view.seats
        .filter((s) => s.inHand || s.stack > 0)
        .map((s) => {
          const turn = view.toAct === s.id;
          const winner = view.results?.some((r) => r.winners.includes(s.id) && r.eligible.length > 1);
          return (
            <div
              key={s.id}
              data-testid={`seat-${s.name}`}
              className={cn(
                'bg-surface flex flex-col gap-1 rounded-2xl border p-2 transition',
                turn ? 'border-accent ring-accent animate-pulse ring-2' : 'border-border',
                (s.folded || s.left) && 'opacity-45',
                winner && 'border-success ring-success ring-2',
              )}
            >
              <div className="flex items-center gap-1.5">
                <Avatar name={s.name} size={28} />
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{s.name}</span>
                {s.button && (
                  <span
                    className="grid size-5 place-items-center rounded-full bg-white text-[10px] font-black text-black"
                    title="dealer"
                  >
                    D
                  </span>
                )}
                {s.sb && <Badge className="px-1.5 text-[10px]">SB</Badge>}
                {s.bb && <Badge className="px-1.5 text-[10px]">BB</Badge>}
              </div>
              <div className="flex items-center justify-between text-xs">
                <Chips n={s.stack} className="text-text" />
                {s.bet > 0 && <Chips n={s.bet} className="text-accent" />}
              </div>
              <div className="flex min-h-5 items-center gap-1 text-[11px]">
                {s.allIn && (
                  <Badge className="bg-danger/25 text-text px-1.5 text-[10px]">{t('poker.allInTag')}</Badge>
                )}
                {s.left ? (
                  <span className="text-muted">🚪 {t('poker.leftTag')}</span>
                ) : (
                  s.folded && <span className="text-muted">{t('poker.foldedTag')}</span>
                )}
                {!s.folded && !s.allIn && s.lastAction && (
                  <span className="text-muted">{t(`poker.act.${s.lastAction}`)}</span>
                )}
                {s.cards && s.id !== me && (
                  <span className="ms-auto flex gap-0.5">
                    {s.cards.map((c) => (
                      <PlayingCard key={c} card={c} size="sm" />
                    ))}
                  </span>
                )}
              </div>
            </div>
          );
        })}
    </div>
  );

  // ---------------------------------------------------------------- my hand
  const myHand = view.me?.hole && (
    <Card className="flex items-center gap-3 p-3" data-testid="my-hand">
      <button
        type="button"
        onClick={() => setShowHole(!showHole)}
        className="flex gap-1.5"
        aria-label={showHole ? t('poker.hideCards') : t('poker.showCards')}
        data-testid="toggle-hole"
      >
        {view.me.hole.map((c) => (
          <PlayingCard key={c} card={c} size="lg" hidden={!showHole} />
        ))}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-muted text-xs">{showHole ? t('poker.tapToHide') : t('poker.tapToShow')}</span>
        {showHole && view.me.category && (
          <b className="text-accent" data-testid="my-category">
            {t(`poker.cat.${view.me.category}`)}
          </b>
        )}
        {seat && <Chips n={seat.stack} />}
      </div>
    </Card>
  );

  // ---------------------------------------------------------------- actions
  const actionBar = legal && (
    <div className="flex flex-col gap-2" data-testid="actions">
      {!me && actor && (
        <b className="text-center text-lg" data-testid="turn-of">
          {t('poker.turnOf', { name: actor.name })}
        </b>
      )}
      {view.actionEndsAt && (
        <Timer
          endsAt={view.actionEndsAt}
          total={view.actionSeconds}
          now={now}
          size={64}
          onTick={(s) => s > 0 && s <= 5 && play('tick')}
        />
      )}
      <div className={cn('grid gap-2', legal.canRaise ? 'grid-cols-3' : 'grid-cols-2')}>
        <Button
          variant="danger"
          size="lg"
          onClick={() => send({ type: 'fold' }, 'wrong')}
          data-testid="poker-fold"
        >
          {t('poker.fold')}
        </Button>
        {legal.canCheck ? (
          <Button
            variant="secondary"
            size="lg"
            onClick={() => send({ type: 'check' })}
            data-testid="poker-check"
          >
            {t('poker.check')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="lg"
            onClick={() => send({ type: 'call' })}
            data-testid="poker-call"
          >
            {legal.toCall >= (actor?.stack ?? Infinity)
              ? t('poker.allIn')
              : t('poker.call', { n: legal.toCall })}
          </Button>
        )}
        {legal.canRaise && (
          <Button size="lg" onClick={() => setRaiseOpen(!raiseOpen)} data-testid="poker-raise">
            {view.currentBet === 0 ? t('poker.bet') : t('poker.raise')}
          </Button>
        )}
      </div>
      {raiseOpen && legal.canRaise && (
        <Card className="flex flex-col gap-3 p-3" data-testid="raise-panel">
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">
              {view.currentBet === 0 ? t('poker.betTo') : t('poker.raiseTo')}
            </span>
            <Chips n={raiseTo} className="text-accent text-2xl" />
          </div>
          <input
            type="range"
            dir="ltr"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={Math.max(1, Math.floor(view.bb / 2))}
            value={raiseTo}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
            aria-label={t('poker.raiseTo')}
            className="h-8 w-full accent-[var(--accent)]"
            data-testid="raise-slider"
          />
          <div className="grid grid-cols-4 gap-1.5">
            {[
              ['min', legal.minRaiseTo],
              ['half', preset(0.5)],
              ['pot', preset(1)],
              ['max', legal.maxRaiseTo],
            ].map(([k, v]) => (
              <Button
                key={k as string}
                size="sm"
                variant="secondary"
                onClick={() => setRaiseTo(v as number)}
                data-testid={`preset-${k}`}
              >
                {t(`poker.preset.${k}`)}
              </Button>
            ))}
          </div>
          <Button
            size="lg"
            onClick={() =>
              send(
                raiseTo >= legal.maxRaiseTo ? { type: 'allIn' } : { type: 'raise', to: raiseTo },
                raiseTo >= legal.maxRaiseTo ? 'buzz' : 'tap',
              )
            }
            data-testid="raise-confirm"
          >
            {raiseTo >= legal.maxRaiseTo
              ? t('poker.allIn')
              : `${view.currentBet === 0 ? t('poker.bet') : t('poker.raise')} ${num(raiseTo)}`}
          </Button>
        </Card>
      )}
    </div>
  );

  const waiting = view.phase === 'betting' && !myTurn && view.toAct && (
    <Notice>{t('poker.waitingFor', { name: name(view.toAct) })}</Notice>
  );

  // ---------------------------------------------------------------- physical: dealer prompt
  const dealing = view.phase === 'dealing' && (
    <Card className="flex flex-col items-center gap-3 py-4 text-center" data-testid="dealing">
      <span className="text-4xl">🃏</span>
      <b className="text-lg">{t(`poker.dealNow.${view.street}`)}</b>
      {isHost ? (
        <Button size="lg" onClick={() => send({ type: 'dealt' })} data-testid="poker-dealt">
          {t('poker.dealtDone')}
        </Button>
      ) : (
        <span className="text-muted text-sm">{t('poker.waitDealer')}</span>
      )}
    </Card>
  );

  // ---------------------------------------------------------------- physical: who won?
  const openPot = view.pending.findIndex((p) => p.winners.length === 0);
  const picking = view.phase === 'pick' && openPot >= 0 && (
    <Card className="flex flex-col gap-3 p-3" data-testid="pick">
      <b>{t('poker.showdownPhysical')}</b>
      <span className="text-sm">
        {view.pending.length > 1 ? t('poker.sidePotN', { n: openPot + 1 }) : t('poker.mainPot')} ·{' '}
        <Chips n={view.pending[openPot]!.amount} />
      </span>
      {isHost ? (
        <>
          <span className="text-muted text-xs">{t('poker.pickHint')}</span>
          <div className="flex flex-col gap-2">
            {view.pending[openPot]!.eligible.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={picks.includes(id)}
                data-testid={`win-${name(id)}`}
                onClick={() => setPicks(picks.includes(id) ? picks.filter((x) => x !== id) : [...picks, id])}
                className={cn(
                  'bg-surface-2 flex min-h-12 items-center gap-2 rounded-xl px-3 text-start font-bold',
                  picks.includes(id) && 'ring-success ring-2',
                )}
              >
                <Avatar name={name(id)} size={28} />
                {name(id)}
                {picks.includes(id) && <span className="ms-auto">🏆</span>}
              </button>
            ))}
          </div>
          <Button
            size="lg"
            disabled={!picks.length}
            onClick={() => {
              send({ type: 'pickWinners', pot: openPot, winners: picks }, 'win');
              setPicks([]);
            }}
            data-testid="confirm-winners"
          >
            {picks.length > 1 ? t('poker.split', { n: picks.length }) : t('poker.giveChips')}
          </Button>
        </>
      ) : (
        <span className="text-muted text-sm">{t('poker.hostPicks')}</span>
      )}
    </Card>
  );

  // ---------------------------------------------------------------- hand over
  const results = view.phase === 'handOver' && view.results && (
    <Card className="border-success/50 flex flex-col gap-2 p-3" data-testid="hand-results">
      {view.results
        .filter((r) => r.amount > 0)
        .map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="text-lg">🏆</span>
            <b>{r.winners.map(name).join('، ')}</b>
            <Chips n={r.amount} className="text-accent" />
            {r.category && <Badge>{t(`poker.cat.${r.category}`)}</Badge>}
            {r.eligible.length === 1 && view.results!.length > 1 && (
              <span className="text-muted text-xs">{t('poker.returned')}</span>
            )}
          </div>
        ))}
      {isHost ? (
        <Button size="lg" onClick={() => send({ type: 'nextHand' }, 'reveal')} data-testid="next-hand">
          🃏 {t('poker.nextHand')}
        </Button>
      ) : (
        <span className="text-muted text-sm">{t('mafia.waitHost')}</span>
      )}
    </Card>
  );

  return (
    <div className="flex flex-col gap-3">
      {table}
      {results}
      {dealing}
      {picking}
      {myHand}
      {actionBar}
      {waiting}
      {seats}
      {view.log.length > 0 && (
        <div className="text-muted flex flex-col gap-0.5 text-xs" data-testid="poker-log">
          {[...view.log].reverse().map((m, i) => (
            <span key={i}>{tm(m)}</span>
          ))}
        </div>
      )}
      {isHost && view.phase !== 'over' && (
        <Button variant="ghost" onClick={() => send({ type: 'end' })}>
          {t('poker.endGame')}
        </Button>
      )}
    </div>
  );
}
