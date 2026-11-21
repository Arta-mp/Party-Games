import { useEffect, useRef, useState } from 'react';

/**
 * «روی پیشانی»: phone held on the forehead in landscape. Tilting the screen down (towards the floor)
 * = correct, tilting up = skip. We look at the change of `gamma`/`beta` from a calibrated baseline and
 * require a return to neutral before the next trigger. iOS needs an explicit permission request.
 */
type Perm = 'unknown' | 'granted' | 'denied' | 'unsupported';

export function useTilt(active: boolean, onDown: () => void, onUp: () => void) {
  const [perm, setPerm] = useState<Perm>(() =>
    typeof window === 'undefined' || !('DeviceOrientationEvent' in window) ? 'unsupported' : 'unknown',
  );
  const base = useRef<number | null>(null);
  const armed = useRef(true);
  const cb = useRef({ onDown, onUp });
  useEffect(() => {
    cb.current = { onDown, onUp };
  }, [onDown, onUp]);

  useEffect(() => {
    if (!active || perm === 'denied' || perm === 'unsupported') return;
    base.current = null;
    const handler = (e: DeviceOrientationEvent) => {
      // in landscape the forehead tilt shows up on gamma; fall back to beta in portrait
      const landscape = screen.orientation?.type ? screen.orientation.type.startsWith('landscape') : window.innerWidth > window.innerHeight;
      const v = landscape ? e.gamma : e.beta;
      if (v == null) return;
      if (base.current == null) {
        base.current = v;
        return;
      }
      const d = v - base.current;
      if (armed.current && Math.abs(d) > 35) {
        armed.current = false;
        if (d > 0) cb.current.onDown();
        else cb.current.onUp();
      } else if (!armed.current && Math.abs(d) < 12) armed.current = true;
    };
    window.addEventListener('deviceorientation', handler);
    if (perm === 'unknown') setPerm('granted');
    return () => window.removeEventListener('deviceorientation', handler);
  }, [active, perm]);

  const request = async () => {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
    if (typeof DOE?.requestPermission === 'function') {
      try {
        setPerm(await DOE.requestPermission());
      } catch {
        setPerm('denied');
      }
    } else setPerm('granted');
  };
  const needsButton = typeof window !== 'undefined' && typeof (window.DeviceOrientationEvent as unknown as { requestPermission?: unknown })?.requestPermission === 'function' && perm !== 'granted';
  return { perm, request, needsButton };
}
