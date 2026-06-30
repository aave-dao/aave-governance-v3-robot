import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getAssetEntry } from '@/lib/feeds/build';
import { AssetFeedView } from '@/components/feeds/AssetFeedView';
import { RefreshButton } from '@/components/feeds/RefreshButton';

export const revalidate = 86400;
export const maxDuration = 120;

export default async function AssetPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await params;
  const symbol = decodeURIComponent(raw);
  const entry = await getAssetEntry(symbol);
  if (!entry) notFound();

  const totalSources = entry.chains.reduce((n, c) => n + c.feeds.length, 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/feeds/assets"
          className="inline-flex items-center gap-1.5 text-[12px] text-fg-dim hover:text-fg-muted"
        >
          <ArrowLeft size={13} /> Assets
        </Link>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-mono text-[20px] font-semibold tracking-tight">{entry.symbol}</h1>
          <p className="text-[12px] text-fg-dim">
            {entry.chains.length} {entry.chains.length === 1 ? 'chain' : 'chains'} · {totalSources}{' '}
            distinct {totalSources === 1 ? 'source' : 'sources'}
          </p>
        </div>
        <RefreshButton />
      </header>

      <AssetFeedView entry={entry} />
    </div>
  );
}
