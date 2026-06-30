'use client';

import { usePathname } from 'next/navigation';

// The cache cadence differs by section: proposal data is refreshed by a per-minute cron,
// while the price-feed topology is scanned by a 12-hourly cron (+ on-demand refresh button).
// Show the cadence that matches the route the operator is actually looking at.
export function CacheStatus() {
  const pathname = usePathname();
  const onFeeds = pathname?.startsWith('/feeds') ?? false;
  const label = onFeeds ? 'refreshed every 12h' : 'cached every minute';
  return (
    <div className="flex items-center gap-2 sm:gap-3 text-xs text-fg-dim">
      <span className="font-mono hidden sm:inline">{label}</span>
      <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
    </div>
  );
}
