import { cva, type VariantProps } from 'class-variance-authority';
import { AnimatePresence, m } from 'motion/react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { avatarColor, initials } from '@/core/identity/identity';
import { useNum, useT } from '@/i18n';
import { cn } from './cn';

// ------------------------------------------------------------------ Button
export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 rounded-2xl font-bold transition-[transform,background,opacity] duration-150 active:scale-[.97] disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink shadow-card',
        secondary: 'border border-border bg-surface-2 text-text',
        ghost: 'text-text hover:bg-surface-2',
        outline: 'border-2 border-accent text-accent',
        danger: 'bg-danger text-white',
        success: 'bg-success text-black',
      },
      size: {
        sm: 'h-12 px-4 text-sm',
        md: 'h-12 px-5 text-base',
        lg: 'h-14 px-6 text-lg',
        xl: 'h-16 px-6 text-xl',
        icon: 'size-12 text-xl',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  );
});

// ------------------------------------------------------------------ Card
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('border-border bg-surface rounded-[var(--radius-card)] border p-4', className)}
      {...props}
    />
  );
}

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'bg-surface-2 text-muted inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        className,
      )}
      {...props}
    />
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'success';
  children: ReactNode;
}) {
  const tones = {
    info: 'border-accent/40 bg-accent/10',
    warn: 'border-brand/50 bg-brand/10',
    danger: 'border-danger/50 bg-danger/10',
    success: 'border-success/50 bg-success/10',
  };
  return (
    <div className={cn('rounded-2xl border px-4 py-3 text-sm leading-7', tones[tone])} role="status">
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ Avatar / PlayerChip
export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-black text-black/80',
        className,
      )}
      style={{ width: size, height: size, background: avatarColor(name), fontSize: size * 0.42 }}
    >
      {initials(name)}
    </span>
  );
}

export function PlayerChip({
  name,
  badges,
  muted,
  selected,
  onClick,
  trailing,
  className,
  testId,
}: {
  name: string;
  badges?: ReactNode;
  muted?: boolean;
  selected?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      data-testid={testId}
      aria-pressed={onClick ? selected : undefined}
      className={cn(
        'border-border bg-surface flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3 py-2 text-start transition',
        muted && 'opacity-45',
        selected && 'border-accent bg-accent/15 ring-accent ring-2',
        onClick && 'active:scale-[.98]',
        className,
      )}
    >
      <Avatar name={name} />
      <span className="min-w-0 flex-1 truncate font-bold">{name}</span>
      {badges}
      {trailing}
    </Comp>
  );
}

// ------------------------------------------------------------------ Screen layout
export function Screen({
  title,
  onBack,
  family,
  children,
  footer,
  headerEnd,
  className,
}: {
  title?: ReactNode;
  onBack?: () => void;
  family?: string;
  children: ReactNode;
  footer?: ReactNode;
  headerEnd?: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <div data-family={family} className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      {(title || onBack || headerEnd) && (
        <header className="bg-bg/85 sticky top-0 z-20 flex h-16 items-center gap-2 px-4 backdrop-blur">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} aria-label={t('common.back')}>
              <span className="rtl:rotate-180">←</span>
            </Button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-xl font-black">{title}</h1>
          {headerEnd}
        </header>
      )}
      <main className={cn('flex flex-1 flex-col gap-4 px-4 pb-6', className)}>{children}</main>
      {footer && (
        <footer className="safe-bottom border-border bg-bg/90 sticky bottom-0 z-20 flex flex-col gap-2 border-t px-4 pt-3 backdrop-blur">
          {footer}
        </footer>
      )}
    </div>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('text-muted mt-2 text-sm font-bold', className)}>{children}</h2>;
}

// ------------------------------------------------------------------ Sheet (bottom sheet dialog)
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          role="dialog"
          aria-modal
          aria-labelledby={id}
        >
          <m.button
            type="button"
            aria-label="close"
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <m.div
            className="safe-bottom border-border bg-surface relative max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border px-4 pt-3"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <div className="bg-border mx-auto mb-3 h-1.5 w-12 rounded-full" />
            {title && (
              <h2 id={id} className="mb-3 text-lg font-black">
                {title}
              </h2>
            )}
            <div className="flex flex-col gap-3 pb-2">{children}</div>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ------------------------------------------------------------------ form controls
export const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }
>(function TextField({ label, hint, className, id, ...props }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <label htmlFor={fid} className="flex flex-col gap-1.5">
      {label && <span className="text-muted text-sm font-bold">{label}</span>}
      <input
        ref={ref}
        id={fid}
        className={cn(
          'border-border bg-surface-2 placeholder:text-muted/60 focus:border-accent h-14 rounded-2xl border px-4 text-lg font-semibold outline-none',
          className,
        )}
        {...props}
      />
      {hint && <span className="text-muted text-xs">{hint}</span>}
    </label>
  );
});

export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const num = useNum();
  return (
    <div className="bg-surface-2 flex items-center justify-between gap-3 rounded-2xl p-2 ps-4">
      <span className="font-semibold">{label}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${label} −`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          −
        </Button>
        <output className="min-w-16 text-center text-lg font-black" aria-live="polite">
          {format ? format(value) : num(value)}
        </output>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${label} +`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          +
        </Button>
      </div>
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="bg-surface-2 flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-4 py-2 text-start"
    >
      <span className="flex flex-col">
        <span className="font-semibold">{label}</span>
        {hint && <span className="text-muted text-xs">{hint}</span>}
      </span>
      <span
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition',
          checked ? 'bg-accent' : 'bg-border',
        )}
      >
        <span
          className={cn(
            'absolute top-1 size-5 rounded-full bg-white transition-all',
            checked ? 'start-6' : 'start-1',
          )}
        />
      </span>
    </button>
  );
}

export function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-muted text-sm font-bold">{label}</span>}
      <div className="bg-surface-2 flex gap-1 rounded-2xl p-1" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-11 flex-1 rounded-xl px-2 text-sm font-bold transition',
              o.value === value ? 'bg-accent text-accent-ink' : 'text-muted',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Timer (big circular)
export function Timer({
  endsAt,
  total,
  now,
  size = 180,
  onTick,
}: {
  endsAt: number | null;
  total: number;
  now: () => number;
  size?: number;
  /** called once per second during the last 10 seconds */
  onTick?: (secondsLeft: number) => void;
}) {
  const num = useNum();
  const [left, setLeft] = useState(() => (endsAt ? Math.max(0, endsAt - now()) : 0));
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!endsAt) return;
    const update = () => {
      const ms = Math.max(0, endsAt - now());
      setLeft(ms);
      const sec = Math.ceil(ms / 1000);
      if (sec <= 10 && sec !== last.current) {
        last.current = sec;
        onTick?.(sec);
      }
    };
    update();
    const id = setInterval(update, 200);
    return () => clearInterval(id);
  }, [endsAt, now, onTick]);
  const sec = Math.ceil(left / 1000);
  const frac = total > 0 ? Math.min(1, left / (total * 1000)) : 0;
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const urgent = sec <= 10;
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return (
    <div
      className="relative mx-auto grid place-items-center"
      style={{ width: size, height: size }}
      role="timer"
      aria-live="off"
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth={10} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={urgent ? 'var(--danger)' : 'var(--accent)'}
          strokeWidth={10}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 200ms linear' }}
        />
      </svg>
      <span
        data-testid="timer"
        className={cn('ltr absolute text-4xl font-black tabular-nums', urgent && 'text-danger')}
        style={{ fontSize: size * 0.22 }}
      >
        {num(mm)}:{num(ss).padStart(2, num(0))}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ Hold to reveal (flip card)
export function HoldReveal({
  children,
  onSeen,
  label,
  className,
  compact,
}: {
  children: ReactNode;
  onSeen?: () => void;
  label?: string;
  className?: string;
  /** single-line variant for small spaces */
  compact?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const seen = useRef(false);
  const show = () => {
    setOpen(true);
    if (!seen.current) {
      seen.current = true;
      onSeen?.();
    }
  };
  const hide = () => setOpen(false);
  return (
    <div className={cn('relative h-80 w-full [perspective:1200px]', className)}>
      <m.button
        type="button"
        data-testid="hold-reveal"
        aria-label={label ?? t('common.holdToSee')}
        aria-pressed={open}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          show();
        }}
        onPointerUp={hide}
        onPointerCancel={hide}
        onPointerLeave={hide}
        onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && show()}
        onKeyUp={hide}
        onBlur={hide}
        onContextMenu={(e) => e.preventDefault()}
        className="relative size-full touch-none [transform-style:preserve-3d]"
        animate={{ rotateY: open ? 180 : 0 }}
        transition={{ duration: 0.25 }}
      >
        <span className="border-accent/60 bg-surface absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed [backface-visibility:hidden]">
          {!compact && <span className="text-6xl">👆</span>}
          <span className={compact ? 'text-sm font-black' : 'text-lg font-black'}>
            {compact && '👆 '}
            {label ?? t('common.holdToSee')}
          </span>
          {!compact && <span className="text-muted text-sm">{t('common.releaseToHide')}</span>}
        </span>
        <span className="border-accent bg-surface-2 absolute inset-0 flex [transform:rotateY(180deg)] flex-col items-center justify-center gap-2 overflow-hidden rounded-[var(--radius-card)] border-2 p-4 [backface-visibility:hidden]">
          {open && children}
        </span>
      </m.button>
    </div>
  );
}

// ------------------------------------------------------------------ Pass & play hand-off
export function Handoff({ name, onReady, reason }: { name: string; onReady: () => void; reason?: string }) {
  const t = useT();
  return (
    <div className="animate-pop flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center">
      <span className="text-muted text-sm font-bold">{t('pp.giveTo')}</span>
      <Avatar name={name} size={112} />
      <h2 className="text-4xl font-black" data-testid="handoff-name">
        {name}
      </h2>
      {reason && <p className="text-muted max-w-xs">{reason}</p>}
      <Button size="xl" block onClick={onReady} data-testid="handoff-ready">
        {t('pp.iAm', { name })}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ Player picker (votes, targets)
export function PlayerPicker({
  players,
  value,
  onChange,
  disabled,
  badge,
}: {
  players: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: (id: string) => boolean;
  badge?: (id: string) => ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2" role="listbox">
      {players.map((p) => (
        <PlayerChip
          key={p.id}
          name={p.name}
          testId={`pick-${p.name}`}
          selected={value === p.id}
          muted={disabled?.(p.id)}
          onClick={disabled?.(p.id) ? undefined : () => onChange(p.id)}
          badges={badge?.(p.id)}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Confetti (end of round)
export function Confetti({ active }: { active: boolean }) {
  const [pieces] = useState(() =>
    Array.from({ length: 36 }, (_, i) => ({
      left: Math.random() * 100,
      dx: (Math.random() - 0.5) * 40,
      delay: Math.random() * 0.4,
      dur: 1.6 + Math.random() * 1.2,
      color: ['#ffcf5c', '#ff6fb5', '#a98bff', '#2ed3b7', '#ff9f43'][i % 5],
    })),
  );
  if (!active) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 block h-3 w-2 rounded-sm"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animation: `pg-fall ${p.dur}s ${p.delay}s ease-in forwards`,
            ['--dx' as string]: `${p.dx}vw`,
          }}
        />
      ))}
    </div>
  );
}

export function BigWord({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('text-center text-4xl leading-tight font-black break-words', className)}>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-muted py-8 text-center">{children}</p>;
}
