/**
 * Timers are sent as absolute host timestamps (endsAt), never as ticks.
 * Clients correct for clock skew with an offset measured from host messages.
 */
export function remainingMs(endsAt: number | null | undefined, now: number): number {
  if (endsAt == null) return 0;
  return Math.max(0, endsAt - now);
}

export function remainingSeconds(endsAt: number | null | undefined, now: number): number {
  return Math.ceil(remainingMs(endsAt, now) / 1000);
}

export function endsAtFrom(now: number, seconds: number): number {
  return now + Math.round(seconds * 1000);
}

/** offset to add to local Date.now() to get host time. */
export function clockOffset(hostNow: number, localNow: number): number {
  return hostNow - localNow;
}
