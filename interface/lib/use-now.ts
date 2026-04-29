'use client';

import { useEffect, useState } from 'react';

/**
 * Live clock hook for ETA countdowns.
 *
 * Returns `now` in unix seconds, ticking on an adaptive cadence based on the *next event* the
 * caller cares about:
 *   - if next event is < 5 min away  → tick every 1s
 *   - else if < 1 day away           → tick every 15s
 *   - else                            → tick every 60s
 *
 * Pass `null` for `nextEventAt` to default to a 60s cadence.
 *
 * SSR-safe: returns `Math.floor(Date.now() / 1000)` on first render. The first client-side
 * effect will resync immediately, so wrap any rendered relative-time text in
 * `suppressHydrationWarning`.
 */
export const useNow = (nextEventAt: number | null | undefined): number => {
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick(); // resync immediately on mount

    const cadence = (() => {
      if (nextEventAt == null) return 60_000;
      const delta = nextEventAt - Math.floor(Date.now() / 1000);
      if (delta < 0) return 60_000; // event already passed; slow down
      if (delta < 5 * 60) return 1_000;
      if (delta < 24 * 60 * 60) return 15_000;
      return 60_000;
    })();

    const id = setInterval(tick, cadence);
    return () => clearInterval(id);
  }, [nextEventAt]);

  return now;
};
