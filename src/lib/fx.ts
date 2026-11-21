import { useSettings } from '@/app/settings';

/** Short synthesized sounds (no audio files) + vibration. Both respect user settings. */
let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    ctx ??= new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, ms: number, type: OscillatorType = 'sine', gain = 0.08, delay = 0) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + delay / 1000;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + ms / 1000 + 0.02);
}

export type Sfx = 'tick' | 'end' | 'win' | 'lose' | 'tap' | 'correct' | 'wrong' | 'buzz' | 'reveal';

export function play(sfx: Sfx) {
  const s = useSettings.getState();
  if (s.sound && typeof window !== 'undefined') {
    switch (sfx) {
      case 'tick':
        tone(880, 90, 'square', 0.04);
        break;
      case 'end':
        tone(440, 250, 'sawtooth', 0.06);
        tone(330, 400, 'sawtooth', 0.06, 220);
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) => tone(f, 220, 'triangle', 0.07, i * 120));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) => tone(f, 260, 'triangle', 0.07, i * 160));
        break;
      case 'tap':
        tone(660, 40, 'sine', 0.03);
        break;
      case 'correct':
        tone(784, 120, 'triangle', 0.07);
        tone(1046, 160, 'triangle', 0.07, 90);
        break;
      case 'wrong':
        tone(200, 220, 'square', 0.05);
        break;
      case 'buzz':
        tone(140, 450, 'sawtooth', 0.09);
        break;
      case 'reveal':
        tone(520, 80, 'sine', 0.05);
        tone(780, 120, 'sine', 0.05, 70);
        break;
    }
  }
  if (s.vibration && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    const pattern: Record<Sfx, number | number[]> = {
      tick: 30,
      end: [200, 80, 200],
      win: [60, 40, 60, 40, 120],
      lose: 300,
      tap: 10,
      correct: 40,
      wrong: [80, 40, 80],
      buzz: 400,
      reveal: 20,
    };
    try {
      navigator.vibrate(pattern[sfx]);
    } catch {
      /* unsupported */
    }
  }
}
