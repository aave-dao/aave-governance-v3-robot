import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getAssetModel } from '@/lib/feeds/build';
import { RefreshButton } from '@/components/feeds/RefreshButton';

// Composed from the per-chain caches — warm loads are cheap; a cold load scans every chain.
// Refreshed daily by the feed-refresh cron (or the Refresh button); 24h backstop TTL.
export const revalidate = 86400;
export const maxDuration = 120;

export default async function AssetIndexPage() {
  const model = await getAssetModel();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/feeds"
          className="inline-flex items-center gap-1.5 text-[12px] text-fg-dim hover:text-fg-muted"
        >
          <ArrowLeft size={13} /> Price Feeds
        </Link>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-[20px] font-semibold tracking-tight">Assets</h1>
          <p className="text-[12px] text-fg-dim">
            {model.length} distinct symbols across all chains. Click one to see its feed config
            everywhere it&apos;s listed.
          </p>
        </div>
        <RefreshButton />
      </header>

      {model.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-[13px] text-fg-muted">
          No assets scanned yet — try refresh.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {model.map((a) => (
            <Link
              key={a.symbol}
              href={`/feeds/asset/${encodeURIComponent(a.symbol)}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3.5 py-3 hover:border-border-strong hover:bg-surface-elev"
            >
              <span className="truncate font-mono text-[13px] font-semibold">{a.symbol}</span>
              <span className="shrink-0 text-[11px] text-fg-dim">
                {a.chains.length} {a.chains.length === 1 ? 'chain' : 'chains'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
