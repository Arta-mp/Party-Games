import { useEffect, useRef, useState } from 'react';
import type { PlayProps, SetupProps } from '@/core/engine/types';
import { PackPicker } from '@/custom/PackPicker';
import { useNum, useT } from '@/i18n';
import { play } from '@/lib/fx';
import { cn } from '@/ui/cn';
import { Avatar, Badge, BigWord, Button, Card, HoldReveal, Notice, PlayerChip, Stepper, TextField, Timer, Toggle } from '@/ui/kit';
import { COLORS, decodePoints, encodePoints, simplify, WIDTHS, type DrawAction, type DrawConfig, type DrawView, type Stroke } from './drawing';

export function DrawingSetup({ config, onChange }: SetupProps<DrawConfig>) {
  const t = useT();
  const num = useNum();
  return (
    <div className="flex flex-col gap-3">
      <Toggle label={t('draw.cfg.canvas')} hint={t('draw.cfg.canvasHint')} checked={config.canvas} onChange={(canvas) => onChange({ ...config, canvas })} />
      <Stepper label={t('wg.cfg.turn')} value={config.turnSeconds} min={30} max={240} step={10} format={(v) => t('common.seconds', { n: num(v) })} onChange={(turnSeconds) => onChange({ ...config, turnSeconds })} />
      <Stepper label={t('wg.cfg.rounds')} value={config.rounds} min={1} max={4} onChange={(rounds) => onChange({ ...config, rounds })} />
      <PackPicker kind="words" value={config.packs} onChange={(packs) => onChange({ ...config, packs })} />
    </div>
  );
}

/** Canvas that renders all strokes and (for the drawer) records new ones. Coordinates are normalised 0..1. */
function Board({ strokes, editable, onStroke, color, width }: { strokes: Stroke[]; editable: boolean; onStroke?: (s: Stroke) => void; color: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const current = useRef<[number, number][] | null>(null);
  const draw = (ctx: CanvasRenderingContext2D, pts: [number, number][], c: number, w: number, size: number) => {
    if (!pts.length) return;
    ctx.strokeStyle = COLORS[c]!;
    ctx.lineWidth = (WIDTHS[w]! * size) / 400;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0]![0] * size, pts[0]![1] * size);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x * size, y * size);
    if (pts.length === 1) ctx.lineTo(pts[0]![0] * size + 0.1, pts[0]![1] * size);
    ctx.stroke();
  };
  const redraw = () => {
    const cv = ref.current;
    if (!cv) return;
    const size = cv.width;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, size, size);
    for (const s of strokes) draw(ctx, decodePoints(s.d), s.c, s.w, size);
    if (current.current) draw(ctx, current.current, color, width, size);
  };
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cv.clientWidth * dpr);
    cv.height = cv.width;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  return (
    <canvas
      ref={ref}
      data-testid="canvas"
      className={cn('aspect-square w-full touch-none rounded-2xl border border-border', editable && 'cursor-crosshair')}
      onPointerDown={(e) => {
        if (!editable) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        current.current = [point(e)];
        redraw();
      }}
      onPointerMove={(e) => {
        if (!current.current) return;
        current.current.push(point(e));
        redraw();
      }}
      onPointerUp={() => {
        const pts = current.current;
        current.current = null;
        if (!pts || !onStroke) return;
        const simple = simplify(pts).slice(0, 600);
        onStroke({ c: color, w: width, d: encodePoints(simple) });
      }}
    />
  );
}

export function DrawingPlay({ view, dispatch, me, isHost, now }: PlayProps<DrawView, DrawAction>) {
  const t = useT();
  const num = useNum();
  const [color, setColor] = useState(0);
  const [width, setWidth] = useState(1);
  const [guess, setGuess] = useState('');
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  const amDrawer = me === view.drawer;
  const canRun = amDrawer || isHost;

  const scoreboard = (
    <div className="flex flex-wrap gap-1.5">
      {[...view.players]
        .sort((a, b) => (view.scores[b.id] ?? 0) - (view.scores[a.id] ?? 0))
        .map((p) => (
          <Badge key={p.id} className={cn(view.solved.includes(p.id) && 'bg-success/25 text-text')}>
            {p.id === view.drawer ? '🎨' : view.solved.includes(p.id) ? '✅' : ''} {p.name} {num(view.scores[p.id] ?? 0)}
          </Badge>
        ))}
    </div>
  );

  if (view.phase === 'ready') {
    return (
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col items-center gap-3 py-6 text-center">
          <Badge>{t('wg.turnOf', { n: view.turn + 1, total: view.totalTurns })}</Badge>
          <Avatar name={name(view.drawer)} size={72} />
          <h2 className="text-2xl font-black">{t('draw.drawer', { name: name(view.drawer) })}</h2>
        </Card>
        {canRun && (
          <Button size="xl" onClick={() => dispatch({ type: 'start' })} data-testid="draw-start">
            ▶ {t('wg.go')}
          </Button>
        )}
        {scoreboard}
      </div>
    );
  }

  if (view.phase === 'draw') {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {view.endsAt && <Timer endsAt={view.endsAt} total={view.turnSeconds} now={now} size={72} onTick={(s) => s > 0 && s <= 5 && play('tick')} />}
          <div className="flex-1">
            {view.word ? (
              view.local ? (
                <HoldReveal compact className="h-16" label={t('draw.peekWord')}>
                  <b className="text-xl">{view.word}</b>
                </HoldReveal>
              ) : (
                <BigWord className="text-2xl text-accent">
                  <span data-testid="draw-word">{view.word}</span>
                </BigWord>
              )
            ) : (
              <p className="text-center text-lg font-bold">
                {t('draw.guessWhat', { name: name(view.drawer) })} <span className="ltr text-muted">{'_ '.repeat(view.wordLength)}</span>
              </p>
            )}
          </div>
        </div>
        {view.canvas ? (
          <Board strokes={view.strokes} editable={amDrawer} color={color} width={width} onStroke={(s) => dispatch({ type: 'stroke', s })} />
        ) : (
          <Card className="py-10 text-center text-lg">📝 {t('draw.paper')}</Card>
        )}
        {amDrawer && view.canvas && (
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map((c, i) => (
              <button key={c} type="button" aria-label={c} onClick={() => setColor(i)} className={cn('size-9 rounded-full border-2', color === i ? 'border-accent' : 'border-border')} style={{ background: c }} />
            ))}
            {WIDTHS.map((w, i) => (
              <button key={w} type="button" onClick={() => setWidth(i)} className={cn('grid size-9 place-items-center rounded-full bg-surface-2', width === i && 'ring-2 ring-accent')} aria-label={`width ${w}`}>
                <span className="rounded-full bg-text" style={{ width: Math.min(24, w), height: Math.min(24, w) }} />
              </button>
            ))}
            <Button variant="ghost" size="icon" onClick={() => dispatch({ type: 'undo' })} aria-label="undo">
              ↶
            </Button>
            <Button variant="ghost" size="icon" onClick={() => dispatch({ type: 'clear' })} aria-label="clear">
              🗑️
            </Button>
          </div>
        )}
        {(amDrawer || (view.local && isHost)) && (!view.canvas || view.local) && (
          <div className="flex flex-col gap-2">
            <b className="text-sm text-muted">{t('draw.markWho')}</b>
            {view.players
              .filter((p) => p.id !== view.drawer)
              .map((p) => (
                <PlayerChip key={p.id} name={p.name} selected={view.solved.includes(p.id)} onClick={view.solved.includes(p.id) ? undefined : () => dispatch({ type: 'mark', player: p.id })} />
              ))}
          </div>
        )}
        {!amDrawer && me && !view.local && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!guess.trim()) return;
              dispatch({ type: 'guess', text: guess.trim() });
              setGuess('');
            }}
          >
            <div className="flex-1">
              <TextField value={guess} onChange={(e) => setGuess(e.target.value)} placeholder={view.solved.includes(me) ? t('draw.solved') : t('draw.typeGuess')} disabled={view.solved.includes(me)} data-testid="draw-guess" aria-label={t('draw.typeGuess')} />
            </div>
            <Button type="submit" size="lg" className="h-14" disabled={view.solved.includes(me)} data-testid="draw-send">
              ↵
            </Button>
          </form>
        )}
        <div className="flex max-h-40 flex-col-reverse gap-1 overflow-y-auto" data-testid="guess-feed">
          {[...view.guesses].reverse().map((g, i) => (
            <span key={i} className={cn('text-sm', g.ok ? 'font-bold text-success' : 'text-muted')}>
              {name(g.p)}: {g.ok ? (g.text ? `${g.text} ✅` : t('draw.gotIt')) : g.text}
            </span>
          ))}
        </div>
        {scoreboard}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Notice tone="success">{t('draw.itWas', { word: view.word ?? '' })}</Notice>
      {view.canvas && <Board strokes={view.strokes} editable={false} color={0} width={0} />}
      {scoreboard}
      {canRun && (
        <Button size="lg" onClick={() => dispatch({ type: 'next' })} data-testid="draw-next">
          {t('wg.nextTurn')}
        </Button>
      )}
    </div>
  );
}
