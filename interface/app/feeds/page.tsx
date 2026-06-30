import Link from 'next/link';
import { ArrowRight, Boxes, Layers } from 'lucide-react';
import { listChains } from '@/lib/feeds/markets';
import { RefreshButton } from '@/components/feeds/RefreshButton';

// The overview is built purely from the static market registry (no RPC), so it's instant.
// The per-chain / per-asset scans happen behind the cached builders on their own routes.
export const revalidate = 3600;

export const metadata = {
  title: 'Price Feeds — Aave Governance V3 Robot',
  description: 'Aave price-feed topology: CAPO adapters and their Chainlink sources, live from chain.',
};

export default function FeedsOverview() {
  const chains = listChains();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-[20px] font-semibold tracking-tight">Price Feeds</h1>
          <p className="max-w-2xl text-[13px] text-fg-muted">
            How every listed asset is priced — the nested CAPO adapter config and where it lands on
            Chainlink — read live from chain across V3 markets and V4 spokes. Deduped per chain and
            per asset.
          </p>
        </div>
        <RefreshButton />
      </header>

      <Link
        href="/feeds/assets"
        className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 hover:border-border-strong hover:bg-surface-elev"
      >
        <span className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent-bg text-accent">
            <Boxes size={15} />
          </span>
          <span>
            <span className="block text-[14px] font-semibold">Browse by asset</span>
            <span className="block text-[12px] text-fg-dim">
              See how one asset is priced across every chain and market
            </span>
          </span>
        </span>
        <ArrowRight size={16} className="text-fg-dim transition-transform group-hover:translate-x-0.5" />
      </Link>

      <section className="space-y-3">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.06em] text-fg-dim">
          By chain · {chains.length} networks
        </h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {chains.map((c) => (
            <Link
              key={c.chainId}
              href={`/feeds/chain/${c.chainId}`}
              className="group flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3.5 hover:border-border-strong hover:bg-surface-elev"
            >
              <span className="flex items-center justify-between">
                <span className="text-[14px] font-semibold">{c.name}</span>
                <Layers size={14} className="text-fg-dim" />
              </span>
              <span className="font-mono text-[11px] text-fg-dim">
                chain {c.chainId} · {c.marketCount} {c.marketCount === 1 ? 'market' : 'markets'}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
