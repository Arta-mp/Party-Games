import { useState } from 'react';
import { useT } from '@/i18n';
import { Button } from '@/ui/kit';
import { useSettings } from './settings';

const SLIDES = [
  { emoji: '🎉', k: 'tut.1' },
  { emoji: '🌐', k: 'tut.2' },
  { emoji: '📱', k: 'tut.3' },
  { emoji: '👆', k: 'tut.4' },
];

/** First-run in-app tutorial (can be replayed from settings). */
export function Tutorial() {
  const t = useT();
  const seen = useSettings((s) => s.tutorialSeen);
  const set = useSettings((s) => s.set);
  const [i, setI] = useState(0);
  if (seen) return null;
  const last = i === SLIDES.length - 1;
  const slide = SLIDES[i]!;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4" role="dialog" aria-modal data-testid="tutorial">
      <div className="safe-bottom flex w-full max-w-lg flex-col items-center gap-4 rounded-3xl border border-border bg-surface p-6 text-center animate-pop">
        <span className="text-6xl">{slide.emoji}</span>
        <h2 className="text-2xl font-black">{t(`${slide.k}.title`)}</h2>
        <p className="leading-8 text-muted">{t(`${slide.k}.body`)}</p>
        <div className="flex gap-1.5" aria-hidden>
          {SLIDES.map((_, j) => (
            <span key={j} className={`h-2 rounded-full transition-all ${j === i ? 'w-6 bg-accent' : 'w-2 bg-border'}`} />
          ))}
        </div>
        <div className="grid w-full grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => set({ tutorialSeen: true })} data-testid="tutorial-skip">
            {t('tut.skip')}
          </Button>
          <Button onClick={() => (last ? set({ tutorialSeen: true }) : setI(i + 1))} data-testid="tutorial-next">
            {last ? t('tut.go') : t('tut.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
