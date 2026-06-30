import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getChainGraph } from '@/lib/feeds/build';
import { CHAIN_IDS, chainName } from '@/lib/feeds/markets';
import { ChainFeedView } from '@/components/feeds/ChainFeedView';
import { RefreshButton } from '@/components/feeds/RefreshButton';

// On-demand ISR: the multicall scan runs on first request, then the rendered page + the
// underlying unstable_cache entry are served until revalidated (the daily feed-refresh cron,
// the refresh button, or the 24h backstop TTL).
export const revalidate = 86400;
export const maxDuration = 60;

export default async function ChainFeedPage({
  params,
}: {
  params: Promise<{ chainId: string }>;
}) {
  const { chainId: raw } = await params;
  const chainId = Number(raw);
  if (!Number.isInteger(chainId) || !CHAIN_IDS.includes(chainId)) notFound();

  let graph: Awaited<ReturnType<typeof getChainGraph>> | null = null;
  let error: string | null = null;
  try {
    graph = await getChainGraph(chainId);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

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
          <h1 className="text-[20px] font-semibold tracking-tight">
            {chainName(chainId)} <span className="font-mono text-[13px] text-fg-dim">· chain {chainId}</span>
          </h1>
          {graph && (
            <p className="text-[12px] text-fg-dim">
              {graph.assets.length} assets · {graph.nodes.length} nodes · {graph.markets.length}{' '}
              markets ·{' '}
              <span suppressHydrationWarning>
                scanned {new Date(graph.generatedAt).toLocaleString()}
              </span>
            </p>
          )}
        </div>
        <RefreshButton chainId={chainId} />
      </header>

      {error ? (
        <div className="rounded-lg border border-danger-border bg-danger-bg px-4 py-6 text-[13px] text-danger">
          <div className="font-semibold">Scan failed</div>
          <div className="mt-1 break-words text-danger/80">{error}</div>
          <div className="mt-3">
            <RefreshButton chainId={chainId} />
          </div>
        </div>
      ) : graph ? (
        <ChainFeedView graph={graph} />
      ) : null}
    </div>
  );
}
