'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AddressLink } from '@/components/AddressLink';
import { cn } from '@/components/ui/cn';
import type { AssetEntry, FeedNode } from '@/lib/feeds/types';

// React port of the reference HTML's left→right dependency graph. Sources sit at tier 0 on
// the left; the Aave-consumed feed (green badge) on the right. Bezier SVG edges are measured
// from the laid-out cards. Hover a card to isolate its connections; click a card or asset
// chip to focus just that path; type to filter to paths touching an address/symbol.

type Props = {
  nodes: FeedNode[];
  edges: { from: string; to: string }[];
  assets: AssetEntry[];
  chainId: number;
};

type EdgePath = { key: string; d: string; active: boolean };

const lc = (a: string) => a.toLowerCase();

export function FeedGraph({ nodes, edges, assets, chainId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<EdgePath[]>([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });
  const [resizeTick, setResizeTick] = useState(0);

  const [focused, setFocused] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // ---- indices ----
  const nodeByAddr = useMemo(() => new Map(nodes.map((n) => [lc(n.address), n])), [nodes]);
  const edgesTo = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of edges) (m.get(lc(e.to)) ?? m.set(lc(e.to), []).get(lc(e.to))!).push(lc(e.from));
    return m;
  }, [edges]);
  const edgesFrom = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of edges)
      (m.get(lc(e.from)) ?? m.set(lc(e.from), []).get(lc(e.from))!).push(lc(e.to));
    return m;
  }, [edges]);

  // asset symbol per leaf address (for the green badge + chips)
  const symbolByAddr = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of assets) for (const f of a.feeds) (m.get(lc(f.leaf)) ?? m.set(lc(f.leaf), []).get(lc(f.leaf))!).push(a.symbol);
    return m;
  }, [assets]);
  const rootAddrs = useMemo(() => [...symbolByAddr.keys()], [symbolByAddr]);

  const byTier = useMemo(() => {
    const m = new Map<number, FeedNode[]>();
    let max = 0;
    for (const n of nodes) {
      (m.get(n.tier) ?? m.set(n.tier, []).get(n.tier)!).push(n);
      max = Math.max(max, n.tier);
    }
    for (const list of m.values())
      list.sort((a, b) => (symbolByAddr.has(lc(b.address)) ? 1 : 0) - (symbolByAddr.has(lc(a.address)) ? 1 : 0));
    return { m, max };
  }, [nodes, symbolByAddr]);

  // sources feeding `addr` (walk inputs) ∪ consumers fed by it (walk outputs)
  const involved = useCallback(
    (addr: string) => {
      const set = new Set<string>([addr]);
      const walk = (x: string, adj: Map<string, string[]>) => {
        for (const n of adj.get(x) ?? []) if (!set.has(n)) { set.add(n); walk(n, adj); }
      };
      walk(addr, edgesTo);
      walk(addr, edgesFrom);
      return set;
    },
    [edgesTo, edgesFrom],
  );

  const ancestors = useCallback(
    (addr: string) => {
      const set = new Set<string>([addr]);
      const up = (x: string) => {
        for (const n of edgesTo.get(x) ?? []) if (!set.has(n)) { set.add(n); up(n); }
      };
      up(addr);
      return set;
    },
    [edgesTo],
  );

  // ---- visibility / matching ----
  const q = query.trim().toLowerCase();
  const matched = useMemo(() => {
    if (!q) return null;
    const set = new Set<string>();
    for (const n of nodes) {
      const hitRef = (n.refs ?? []).some((r) => r.includes(q));
      const hitSym = (symbolByAddr.get(lc(n.address)) ?? []).some((s) => s.toLowerCase().includes(q));
      if (hitRef || hitSym) set.add(lc(n.address));
    }
    return set;
  }, [q, nodes, symbolByAddr]);

  const visible = useMemo(() => {
    if (focused) return involved(focused);
    if (matched) {
      const set = new Set<string>();
      for (const r of rootAddrs) {
        const chain = ancestors(r);
        if ([...chain].some((a) => matched.has(a))) for (const a of chain) set.add(a);
      }
      return set.size ? set : new Set<string>(['__none__']);
    }
    return null;
  }, [focused, matched, involved, ancestors, rootAddrs]);

  const isVisible = useCallback((addr: string) => !visible || visible.has(lc(addr)), [visible]);
  const filterActive = !!visible;

  // ---- measure edges after layout ----
  useLayoutEffect(() => {
    const cont = containerRef.current;
    const colsEl = colsRef.current;
    if (!cont || !colsEl) return;
    const gb = cont.getBoundingClientRect();
    const rectOf = (addr: string): DOMRect | null => {
      const el = colsEl.querySelector(`[data-node="${addr}"]`) as HTMLElement | null;
      if (!el || el.dataset.hidden === '1') return null;
      return el.getBoundingClientRect();
    };
    const next: EdgePath[] = [];
    for (const e of edges) {
      const from = lc(e.from);
      const to = lc(e.to);
      if (!isVisible(from) || !isVisible(to)) continue;
      const ra = rectOf(from);
      const rb = rectOf(to);
      if (!ra || !rb) continue;
      const x1 = ra.right - gb.left + cont.scrollLeft;
      const y1 = ra.top - gb.top + cont.scrollTop + ra.height / 2;
      const x2 = rb.left - gb.left + cont.scrollLeft;
      const y2 = rb.top - gb.top + cont.scrollTop + rb.height / 2;
      const dx = Math.max(40, (x2 - x1) / 2);
      const active = hovered ? from === hovered || to === hovered : filterActive;
      next.push({
        key: `${from}-${to}`,
        d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`,
        active,
      });
    }
    setPaths(next);
    setSvgSize({ w: colsEl.scrollWidth, h: colsEl.scrollHeight });
  }, [edges, isVisible, hovered, filterActive, resizeTick, visible]);

  useLayoutEffect(() => {
    const onResize = () => setResizeTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // nodes to dim on hover (those not connected to the hovered node)
  const hoverKeep = useMemo(() => {
    if (!hovered) return null;
    const keep = new Set<string>([hovered]);
    for (const e of edges) {
      if (lc(e.from) === hovered || lc(e.to) === hovered) {
        keep.add(lc(e.from));
        keep.add(lc(e.to));
      }
    }
    return keep;
  }, [hovered, edges]);

  const reset = () => {
    setFocused(null);
    setQuery('');
  };

  const tiers = Array.from({ length: byTier.max + 1 }, (_, t) => t);
  const tierLabel = (t: number) =>
    t === 0 ? 'sources' : t === byTier.max ? 'Aave feed' : `adapters · L${t}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocused(null);
          }}
          placeholder="filter paths by address or symbol…"
          spellCheck={false}
          className="h-8 w-[min(420px,60vw)] rounded-md border border-border bg-bg px-3 font-mono text-[12px] text-fg placeholder:text-fg-dim focus:border-accent-border focus:outline-none"
        />
        {(focused || query) && (
          <button
            onClick={reset}
            className="h-8 rounded-md border border-border bg-surface-elev px-3 text-[12px] text-fg-muted hover:border-border-strong"
          >
            reset
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {assets.flatMap((a) =>
            a.feeds.map((f) => (
              <button
                key={`${a.symbol}-${f.leaf}`}
                onClick={() => {
                  setQuery('');
                  setFocused((cur) => (cur === lc(f.leaf) ? null : lc(f.leaf)));
                }}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
                  focused === lc(f.leaf)
                    ? 'border-accent-border bg-accent-bg text-accent'
                    : 'border-border bg-surface-elev text-fg-muted hover:border-accent-border hover:text-accent',
                )}
              >
                {a.symbol}
              </button>
            )),
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative overflow-auto rounded-lg border border-border bg-surface p-5"
        onClick={(e) => {
          if (e.target === e.currentTarget) reset();
        }}
      >
        <svg
          className="pointer-events-none absolute left-0 top-0 z-0"
          width={svgSize.w}
          height={svgSize.h}
        >
          <defs>
            <marker id="fg-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6 Z" fill="#5a6270" />
            </marker>
          </defs>
          {paths.map((p) => (
            <path
              key={p.key}
              d={p.d}
              fill="none"
              stroke={p.active ? '#7aa6ff' : '#5a6270'}
              strokeWidth={p.active ? 2 : 1.5}
              markerEnd="url(#fg-arrow)"
            />
          ))}
        </svg>

        <div ref={colsRef} className="relative z-[1] flex w-max items-start gap-16">
          {tiers.map((t) => (
            <div key={t} className="flex flex-col gap-5">
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-fg-dim">
                {tierLabel(t)}
              </div>
              {(byTier.m.get(t) ?? []).map((n) => {
                const addr = lc(n.address);
                const symbols = symbolByAddr.get(addr);
                const hidden = !isVisible(addr);
                const dim = !!hoverKeep && !hoverKeep.has(addr);
                return (
                  <div
                    key={addr}
                    data-node={addr}
                    data-hidden={hidden ? '1' : '0'}
                    onMouseEnter={() => !filterActive && setHovered(addr)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => {
                      setQuery('');
                      setFocused((cur) => (cur === addr ? null : addr));
                    }}
                    className={cn(
                      'w-[260px] cursor-pointer rounded-lg border border-border bg-surface-elev transition-opacity',
                      hidden && 'hidden',
                      dim && 'opacity-25',
                      matched?.has(addr) && 'ring-2 ring-accent',
                    )}
                    style={{ borderLeft: `4px solid ${n.color}` }}
                  >
                    <div className="border-b border-border px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold" style={{ color: n.color }}>
                          {n.type}
                        </span>
                        {symbols && (
                          <span className="rounded-full bg-success-bg px-2 py-0.5 text-[10px] font-bold text-success">
                            {symbols.join(', ')}
                          </span>
                        )}
                      </div>
                      <AddressLink address={n.address} chainId={chainId} className="mt-1 text-[10.5px]" />
                    </div>
                    <div className="px-3 py-2">
                      {n.rows.slice(0, 6).map((r, i) => (
                        <div key={`${r.k}-${i}`} className="flex gap-2 py-0.5 text-[11px]">
                          <span className="w-[88px] shrink-0 text-fg-dim">{r.k}</span>
                          <span className={cn('min-w-0 break-words text-fg-muted', r.mono && 'font-mono')}>
                            {r.v}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
