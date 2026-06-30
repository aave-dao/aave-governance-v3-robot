import { AddressLink } from '@/components/AddressLink';
import { Badge } from '@/components/ui/Badge';
import { fmtDuration } from '@/lib/feeds/format';
import type { ChainlinkMeta, FeedNode } from '@/lib/feeds/types';

// Nested path view: render a leaf/adapter node and, indented beneath it, the nodes it reads
// from — so `source → cap/scale adapter → … → Aave-consumed feed` reads top-down. Driven by
// a flat FeedNode list + a root address; children are resolved by address.

function nodeMapOf(nodes: FeedNode[]): Map<string, FeedNode> {
  return new Map(nodes.map((n) => [n.address.toLowerCase(), n]));
}

function FeedNodeCard({
  node,
  map,
  chainId,
  seen,
}: {
  node: FeedNode;
  map: Map<string, FeedNode>;
  chainId: number;
  seen: Set<string>;
}) {
  const key = node.address.toLowerCase();
  const childNodes = node.children
    .map((c) => map.get(c.toLowerCase()))
    .filter((n): n is FeedNode => !!n && !seen.has(n.address.toLowerCase()));

  return (
    <div>
      <div
        className="rounded-md border border-border bg-surface-elev px-3 py-2.5"
        style={{ borderLeft: `3px solid ${node.color}` }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="text-[12.5px] font-semibold" style={{ color: node.color }}>
              {node.type}
            </span>
            {node.chainlink?.due && (
              <Badge tone="warn" size="xs">
                due
              </Badge>
            )}
          </span>
          <AddressLink address={node.address} chainId={chainId} showIcon />
        </div>
        <dl className="mt-1.5 grid grid-cols-[minmax(96px,auto)_1fr] gap-x-3 gap-y-0.5">
          {node.rows.map((r, i) => (
            <div key={`${r.k}-${i}`} className="contents">
              <dt className="truncate text-[11.5px] text-fg-dim">{r.k}</dt>
              <dd
                className={`min-w-0 break-words text-[12px] ${r.mono ? 'font-mono' : ''} text-fg-muted`}
              >
                {r.addr ? (
                  <AddressLink address={r.addr} chainId={chainId} />
                ) : (
                  r.v
                )}
              </dd>
            </div>
          ))}
        </dl>
        {node.chainlink && <ChainlinkStrip cl={node.chainlink} chainId={chainId} />}
      </div>

      {childNodes.length > 0 && (
        <div className="ml-3 mt-1.5 flex flex-col gap-1.5 border-l border-dashed border-border-strong pl-3">
          {childNodes.map((c) => (
            <FeedNodeCard
              key={c.address}
              node={c}
              map={map}
              chainId={chainId}
              seen={new Set([...seen, key])}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChainlinkStrip({ cl, chainId }: { cl: ChainlinkMeta; chainId: number }) {
  const move =
    cl.lastMovePct !== undefined
      ? `${cl.lastMovePct >= 0 ? '+' : ''}${cl.lastMovePct}%`
      : undefined;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-border pt-2 text-[11px]">
      <span className="uppercase tracking-[0.06em] text-fg-dim">Chainlink</span>
      {cl.priceText ? <Meta k="price" v={cl.priceText} /> : null}
      {cl.deviationPct !== undefined ? <Meta k="threshold" v={`${cl.deviationPct}%`} /> : null}
      {move ? <Meta k="last move" v={move} /> : null}
      {cl.heartbeatSec ? <Meta k="heartbeat" v={fmtDuration(cl.heartbeatSec)} /> : null}
      {cl.ageSec !== undefined ? <Meta k="updated" v={`${fmtDuration(cl.ageSec)} ago`} /> : null}
      {cl.feedCategory ? <Meta k="tier" v={cl.feedCategory} /> : null}
      {cl.sourceAddress ? (
        <span>
          <span className="text-fg-dim">source </span>
          <AddressLink address={cl.sourceAddress} chainId={chainId} />
        </span>
      ) : null}
      {cl.due ? (
        <Badge tone="warn" size="xs">
          due for update
        </Badge>
      ) : cl.heartbeatSec ? (
        <Badge tone="success" size="xs">
          on time
        </Badge>
      ) : null}
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <span>
      <span className="text-fg-dim">{k} </span>
      <span className="font-mono text-fg-muted">{v}</span>
    </span>
  );
}

export function FeedTree({
  nodes,
  rootAddress,
  chainId,
}: {
  nodes: FeedNode[];
  rootAddress: string;
  chainId: number;
}) {
  const map = nodeMapOf(nodes);
  const root = map.get(rootAddress.toLowerCase());
  if (!root) {
    return (
      <div className="rounded-md border border-border bg-surface-elev px-3 py-2 text-[12px] text-fg-dim">
        Feed {rootAddress} not found in graph.
      </div>
    );
  }
  return <FeedNodeCard node={root} map={map} chainId={chainId} seen={new Set()} />;
}
