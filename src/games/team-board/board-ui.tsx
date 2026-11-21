import { cn } from '@/ui/cn';

export type CellColor = 'red' | 'blue' | 'neutral' | 'black' | 'green' | null;

const FILL: Record<string, string> = {
  red: 'bg-team-a text-white',
  blue: 'bg-team-b text-white',
  neutral: 'bg-[#d8c9a3] text-black',
  black: 'bg-black text-white',
  green: 'bg-success text-black',
};
const HINT: Record<string, string> = {
  red: 'ring-2 ring-inset ring-team-a',
  blue: 'ring-2 ring-inset ring-team-b',
  neutral: 'ring-1 ring-inset ring-[#d8c9a3]/60',
  black: 'ring-4 ring-inset ring-white/80 bg-black/40',
  green: 'ring-2 ring-inset ring-success',
};

/** 5×5 word grid. `revealed` cells are filled; `hint` (key card) is drawn as a coloured outline. */
export function WordGrid({
  words,
  revealed,
  colors,
  marks,
  onPick,
  disabled,
}: {
  words: string[];
  revealed: boolean[];
  colors: CellColor[];
  marks?: (string | null)[];
  onPick?: (i: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-5 gap-1" data-testid="word-grid">
      {words.map((w, i) => {
        const c = colors[i];
        const open = revealed[i];
        return (
          <button
            key={i}
            type="button"
            disabled={disabled || open || !onPick}
            onClick={() => onPick?.(i)}
            data-testid={`cell-${i}`}
            data-color={open ? c : undefined}
            className={cn(
              'relative grid min-h-14 place-items-center rounded-lg bg-surface-2 p-0.5 text-center text-[11px] leading-4 font-bold break-words transition active:scale-95 disabled:active:scale-100',
              open && c ? FILL[c] : c ? HINT[c] : '',
              open && 'opacity-90',
            )}
          >
            {w}
            {marks?.[i] && <span className="absolute end-0.5 top-0 text-[10px]">{marks[i]}</span>}
          </button>
        );
      })}
    </div>
  );
}
