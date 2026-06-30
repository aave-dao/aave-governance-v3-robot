'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, GitBranch, List } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { Badge } from '@/components/ui/Badge';
import type { AssetEntry, ChainFeedGraph, FeedNode } from '@/lib/feeds/types';
import { FeedTree } from './FeedTree';
import { FeedGraph } from './FeedGraph';
import { MarketTags } from './MarketTags';

const tagsOf = (a: AssetEntry) => [...new Set(a.feeds.flatMap((f) => f.marketTags))].sort();

/** Does any node reachable from `leaf` carry a "due" Chainlink flag? */
function subtreeHasDue(leaf: string, byAddr: Map<string, FeedNode>): boolean {
  const seen = new Set<string>();
  const stack = [leaf.toLowerCase()];
  while (stack.length) {
    const a = stack.pop();
    if (!a || seen.has(a)) continue;
    seen.add(a);
    const n = byAddr.get(a);
    if (!n) continue;
    if (n.chainlink?.due) return true;
    for (const c of n.children) stack.push(c.toLowerCase());
  }
  return false;
}

export function ChainFeedView({ graph }: { graph: ChainFeedGraph }) {
  const [view, setView] = useState<'tree' | 'graph'>('tree');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [dueOnly, setDueOnly] = useState(false);

  const toggle = (symbol: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });

  const toggleTag = (tag: string) =>
    setActiveTags((cur) => {
      const next = new Set(cur);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  // Every market tag that actually appears on this chain, sorted (V3 first, then V4 spokes).
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const a of graph.assets) for (const f of a.feeds) for (const t of f.marketTags) s.add(t);
    return [...s].sort();
  }, [graph.assets]);

  // Which assets have an overdue Chainlink feed anywhere in their adapter path, + chain total.
  const nodeByAddr = useMemo(
    () => new Map(graph.nodes.map((n) => [n.address.toLowerCase(), n])),
    [graph.nodes],
  );
  const dueAssets = useMemo(() => {
    const s = new Set<string>();
    for (const a of graph.assets)
      if (a.feeds.some((f) => subtreeHasDue(f.leaf, nodeByAddr))) s.add(a.symbol);
    return s;
  }, [graph.assets, nodeByAddr]);
  const dueNodeCount = useMemo(() => graph.nodes.filter((n) => n.chainlink?.due).length, [graph.nodes]);

  const q = filter.trim().toLowerCase();
  const assets = useMemo(() => {
    return graph.assets.filter((a) => {
      if (dueOnly && !dueAssets.has(a.symbol)) return false;
      // Tag filter (OR across selected markets): keep assets with a feed in any active market.
      if (activeTags.size && !a.feeds.some((f) => f.marketTags.some((t) => activeTags.has(t)))) {
        return false;
      }
      if (q) {
        const hit =
          a.symbol.toLowerCase().includes(q) ||
          a.feeds.some(
            (f) =>
              f.leaf.toLowerCase().includes(q) || f.marketTags.some((t) => t.toLowerCase().includes(q)),
          );
        if (!hit) return false;
      }
      return true;
    });
  }, [graph.assets, q, activeTags, dueOnly, dueAssets]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
          <ToggleBtn active={view === 'tree'} onClick={() => setView('tree')} icon={<List size={13} />}>
            Tree
          </ToggleBtn>
          <ToggleBtn active={view === 'graph'} onClick={() => setView('graph')} icon={<GitBranch size={13} />}>
            Graph
          </ToggleBtn>
        </div>
        {view === 'tree' && (
          <>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter assets…"
              spellCheck={false}
              className="h-8 w-[min(320px,55vw)] rounded-md border border-border bg-bg px-3 text-[12px] text-fg placeholder:text-fg-dim focus:border-accent-border focus:outline-none"
            />
            <span className="text-[12px] text-fg-dim">
              {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
            </span>
          </>
        )}
      </div>

      {view === 'tree' && allTags.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[11px] uppercase tracking-[0.06em] text-fg-dim">Markets</span>
          {allTags.map((tag) => {
            const on = activeTags.has(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                aria-pressed={on}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium transition-colors',
                  on
                    ? 'border-accent-border bg-accent-bg text-accent'
                    : 'border-border bg-surface-elev text-fg-muted hover:border-accent-border hover:text-accent',
                )}
              >
                {tag}
              </button>
            );
          })}
          {activeTags.size > 0 && (
            <button
              onClick={() => setActiveTags(new Set())}
              className="rounded-full px-2 py-0.5 text-[11px] text-fg-dim hover:text-fg-muted"
            >
              clear
            </button>
          )}
        </div>
      )}

      {dueNodeCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warn-border bg-warn-bg px-3 py-2 text-[12px] text-warn">
          <span className="flex items-center gap-2">
            <AlertTriangle size={14} />
            {dueNodeCount} Chainlink feed{dueNodeCount === 1 ? '' : 's'} overdue past heartbeat ·{' '}
            {dueAssets.size} asset{dueAssets.size === 1 ? '' : 's'} affected
          </span>
          {view === 'tree' && (
            <button
              onClick={() => setDueOnly((v) => !v)}
              className="rounded-full border border-warn-border px-2.5 py-0.5 text-[11px] font-medium hover:bg-warn/10"
            >
              {dueOnly ? 'show all' : 'show due only'}
            </button>
          )}
        </div>
      )}

      {graph.warnings.length > 0 && (
        <div className="rounded-md border border-warn-border bg-warn-bg px-3 py-2 text-[12px] text-warn">
          {graph.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      {view === 'graph' ? (
        <FeedGraph nodes={graph.nodes} edges={graph.edges} assets={graph.assets} chainId={graph.chainId} />
      ) : assets.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-[13px] text-fg-muted">
          No assets match the current filters.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {assets.map((a) => {
            const isOpen = open.has(a.symbol);
            return (
              <div key={a.symbol} className="rounded-lg border border-border bg-surface">
                <button
                  onClick={() => toggle(a.symbol)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <ChevronRight
                    size={15}
                    className={cn('shrink-0 text-fg-dim transition-transform', isOpen && 'rotate-90')}
                  />
                  <span className="font-mono text-[14px] font-semibold">{a.symbol}</span>
                  {dueAssets.has(a.symbol) && (
                    <Badge tone="warn" size="xs">
                      due
                    </Badge>
                  )}
                  <span className="min-w-0 flex-1">
                    <MarketTags tags={tagsOf(a)} />
                  </span>
                  {a.feeds.length > 1 && (
                    <span className="shrink-0 text-[11px] text-fg-dim">{a.feeds.length} sources</span>
                  )}
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
                    {a.feeds.map((f) => (
                      <div key={f.leaf} className="flex flex-col gap-2">
                        {a.feeds.length > 1 && <MarketTags tags={f.marketTags} size="sm" />}
                        <FeedTree nodes={graph.nodes} rootAddress={f.leaf} chainId={graph.chainId} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] font-medium transition-colors',
        active ? 'bg-surface-elev text-fg' : 'text-fg-dim hover:text-fg-muted',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
