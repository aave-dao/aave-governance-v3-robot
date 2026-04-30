'use client';

import { useEffect, useState } from 'react';

/**
 * Live clock hook for ETA countdowns.
 *
 * Returns `now` in unix seconds, ticking on a cadence aligned with the granularity displayed
 * by `fmtRelative`:
 *   - next event < 1 day away → tick every 1s (seconds are visible, must update every second)
 *   - next event > 1 day away → tick every 60s (only minute precision visible at this scale)
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
      // Past or within a day → tick every second so the seconds component visibly counts down.
      if (delta < 24 * 60 * 60) return 1_000;
      return 60_000;
    })();

    const id = setInterval(tick, cadence);
    return () => clearInterval(id);
  }, [nextEventAt]);

  return now;
};
