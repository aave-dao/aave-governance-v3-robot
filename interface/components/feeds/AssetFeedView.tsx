import Link from 'next/link';
import type { AssetModelEntry } from '@/lib/feeds/types';
import { FeedTree } from './FeedTree';
import { MarketTags } from './MarketTags';

// Cross-chain story for one asset symbol. Each chain section lists that chain's distinct
// feeds (already deduped: a feed shared by two markets shows once with both tags), and
// renders each feed's self-contained path closure.
export function AssetFeedView({ entry }: { entry: AssetModelEntry }) {
  return (
    <div className="flex flex-col gap-5">
      {entry.chains.map((c) => (
        <section key={c.chainId} className="rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <Link
              href={`/feeds/chain/${c.chainId}`}
              className="text-[14px] font-semibold hover:text-accent"
            >
              {c.chainName}
            </Link>
            <span className="text-[11px] text-fg-dim">
              {c.feeds.length} {c.feeds.length === 1 ? 'source' : 'sources'}
            </span>
          </div>
          <div className="flex flex-col gap-3 px-4 py-3">
            {c.feeds.map((f) => (
              <div key={f.leaf} className="flex flex-col gap-2">
                <MarketTags tags={f.marketTags} size="sm" />
                <FeedTree nodes={f.nodes} rootAddress={f.leaf} chainId={c.chainId} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
