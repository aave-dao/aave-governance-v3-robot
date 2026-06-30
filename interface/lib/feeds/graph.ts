// The on-chain scan: probe → classify → discover (BFS) → tier → dedup, producing one
// JSON-serializable ChainFeedGraph. Ported from tmp-ref/feed-graph.ts with the I/O swapped
// to the interface's memoized getPublicClient and an explicit Multicall3 address.

import { getAddress, type Address, type PublicClient } from 'viem';
import { getPublicClient } from '@robot/core/clients';
import { AGG_ABI, FEED_ABI, MULTICALL3, PROBE_FNS, type Raw } from './abi';
import { getChainlinkIndex } from './chainlink';
import { classify, type ClassifiedNode } from './classify';
import { chainName, marketsForChain } from './markets';
import { resolveListings, type Listing } from './seeds';
import type { AssetEntry, ChainFeedGraph, Feed, FeedNode, MarketInfo } from './types';

const lc = (a: string) => a.toLowerCase() as Address;

// A Chainlink feed is flagged "due" once it's overdue past its heartbeat. The 10% grace
// avoids flapping for feeds sitting momentarily at the heartbeat boundary between updates.
const DUE_GRACE = 1.1;

/** Multicall every probe fn against every address; return raw results keyed by address. */
async function probe(client: PublicClient, addresses: Address[]): Promise<Map<Address, Raw>> {
  const contracts = addresses.flatMap((address) =>
    PROBE_FNS.map((functionName) => ({ address, abi: FEED_ABI, functionName })),
  );
  const res = (await client.multicall({
    contracts: contracts as never,
    allowFailure: true,
    multicallAddress: MULTICALL3,
  })) as Array<{ status: string; result?: unknown }>;
  const out = new Map<Address, Raw>();
  addresses.forEach((a, i) => {
    const slice = res.slice(i * PROBE_FNS.length, (i + 1) * PROBE_FNS.length);
    const raw: Raw = {};
    PROBE_FNS.forEach((fn, j) => {
      const r = slice[j] as { status: string; result?: unknown } | undefined;
      if (r && r.status === 'success') (raw as Record<string, unknown>)[fn] = r.result;
    });
    out.set(lc(a), raw);
  });
  return out;
}

/** Walk the graph outward from the seed leaves, classifying each node and following its
 *  inputs until no new addresses appear. */
async function discover(
  client: PublicClient,
  seeds: Address[],
): Promise<Map<Address, ClassifiedNode>> {
  const nodes = new Map<Address, ClassifiedNode>();
  let frontier: Address[] = [...new Set(seeds.map(lc))];
  while (frontier.length) {
    const todo = [...new Set(frontier.map(lc))].filter((a) => !nodes.has(a));
    if (!todo.length) break;
    const probed = await probe(client, todo);
    const next: Address[] = [];
    for (const a of todo) {
      const node = classify(a, probed.get(a) ?? {});
      nodes.set(a, node);
      next.push(...node.children.map(lc));
    }
    frontier = next;
  }
  return nodes;
}

/** Tier = longest path to a leaf. Memoized DFS with a cycle guard. */
function computeTiers(nodes: Map<Address, ClassifiedNode>): Map<Address, number> {
  const memo = new Map<Address, number>();
  const tierOf = (a: Address, stack = new Set<Address>()): number => {
    const cached = memo.get(a);
    if (cached !== undefined) return cached;
    const n = nodes.get(a);
    if (!n || n.children.length === 0 || stack.has(a)) {
      memo.set(a, 0);
      return 0;
    }
    stack.add(a);
    const t = 1 + Math.max(...n.children.map((c) => tierOf(lc(c), stack)));
    stack.delete(a);
    memo.set(a, t);
    return t;
  };
  for (const a of nodes.keys()) tierOf(a);
  return memo;
}

/** Realized deviation at the last update per Chainlink leaf: signed % change of the latest
 *  answer vs the previous round's answer. Two extra multicalls (latestRound, then the prior
 *  round) on the proxies — best-effort, skipped on any failure or phase boundary. */
async function computeLastMove(
  client: PublicClient,
  clNodes: ClassifiedNode[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!clNodes.length) return out;

  const rounds = (await client.multicall({
    contracts: clNodes.map((n) => ({
      address: n.address as Address,
      abi: AGG_ABI,
      functionName: 'latestRound',
    })) as never,
    allowFailure: true,
    multicallAddress: MULTICALL3,
  })) as Array<{ status: string; result?: unknown }>;

  const ridOf = (i: number): bigint | undefined => {
    const r = rounds[i];
    return r && r.status === 'success' ? (r.result as bigint) : undefined;
  };

  const prev = (await client.multicall({
    contracts: clNodes.map((n, i) => {
      const rid = ridOf(i);
      return {
        address: n.address as Address,
        abi: AGG_ABI,
        functionName: 'getRoundData',
        args: [rid !== undefined && rid > 0n ? rid - 1n : 0n],
      };
    }) as never,
    allowFailure: true,
    multicallAddress: MULTICALL3,
  })) as Array<{ status: string; result?: unknown }>;

  clNodes.forEach((n, i) => {
    const rid = ridOf(i);
    if (rid === undefined || rid <= 0n || n.answerRaw === undefined) return;
    const pr = prev[i];
    if (!pr || pr.status !== 'success') return;
    // viem returns named multi-outputs as an object; older shapes as an array — handle both.
    const res = pr.result as readonly unknown[] | { answer?: unknown } | undefined;
    const prevAnswer = Array.isArray(res)
      ? (res[1] as bigint | undefined)
      : res && typeof res === 'object' && 'answer' in res
        ? ((res as { answer?: unknown }).answer as bigint | undefined)
        : undefined;
    if (prevAnswer === undefined || prevAnswer === 0n) return;
    const move = (Number(BigInt(n.answerRaw) - prevAnswer) / Math.abs(Number(prevAnswer))) * 100;
    if (Number.isFinite(move)) out.set(n.address.toLowerCase(), Math.round(move * 1000) / 1000);
  });
  return out;
}

/** Group listings by symbol, then dedupe by leaf address — markets sharing a leaf are
 *  clubbed and tagged together. (chainId, leaf) is the dedup key. */
function dedupeAssets(listings: Listing[]): AssetEntry[] {
  const bySymbol = new Map<string, Map<string, Set<string>>>();
  for (const l of listings) {
    const byLeaf = bySymbol.get(l.symbol) ?? new Map<string, Set<string>>();
    const tags = byLeaf.get(l.leaf) ?? new Set<string>();
    tags.add(l.marketName);
    byLeaf.set(l.leaf, tags);
    bySymbol.set(l.symbol, byLeaf);
  }
  const out: AssetEntry[] = [];
  for (const [symbol, byLeaf] of bySymbol) {
    const feeds: Feed[] = [...byLeaf.entries()]
      .map(([leaf, tags]) => ({ leaf: getAddress(leaf), marketTags: [...tags].sort() }))
      .sort((a, b) => a.leaf.localeCompare(b.leaf));
    out.push({ symbol, feeds });
  }
  out.sort((a, b) => a.symbol.localeCompare(b.symbol, undefined, { sensitivity: 'base' }));
  return out;
}

const marketInfo = (markets: ReturnType<typeof marketsForChain>): MarketInfo[] =>
  markets.map((m) => ({
    name: m.name,
    type: m.type,
    oracle: 'oracle' in m ? m.oracle : undefined,
  }));

/** Build the full topology for one chain. Pure I/O — no caching (see build.ts). */
export async function buildChainGraph(chainId: number): Promise<ChainFeedGraph> {
  const markets = marketsForChain(chainId);
  if (!markets.length) throw new Error(`No feed markets registered for chain ${chainId}`);

  const client = getPublicClient(chainId);
  const { listings, warnings } = await resolveListings(client, markets);

  const seedLeaves = [...new Set(listings.map((l) => l.leaf))];
  const nodeMap = await discover(client, seedLeaves);
  const tiers = computeTiers(nodeMap);

  // Chainlink RDD config (deviation/heartbeat) for this chain, used to annotate leaves and
  // derive "due for update" from the on-chain latestTimestamp. Best-effort: empty on failure.
  const clIndex = await getChainlinkIndex(chainId);
  const nowSec = Math.floor(Date.now() / 1000);
  // Realized deviation (latest vs previous round) for every Chainlink leaf on this chain.
  const moveByAddr = await computeLastMove(
    client,
    [...nodeMap.values()].filter((n) => n.type === 'ChainlinkFeed'),
  );

  const nodes: FeedNode[] = [...nodeMap.values()].map((n) => {
    const node: FeedNode = {
      address: n.address,
      short: n.short,
      type: n.type,
      color: n.color,
      rows: n.rows,
      children: n.children.filter((c) => nodeMap.has(lc(c))).map((c) => getAddress(c)),
      tier: tiers.get(lc(n.address)) ?? 0,
      refs: n.refs,
    };
    if (n.type !== 'ChainlinkFeed') return node;

    // Match the leaf by its own address or any address it references (proxy ⇄ aggregator).
    const meta =
      clIndex.get(lc(n.address)) ?? n.refs.map((r) => clIndex.get(r)).find(Boolean);
    if (!meta) return node;

    const ageSec = n.updatedAt !== undefined ? nowSec - n.updatedAt : undefined;
    const hb = meta.heartbeatSec;
    const due = hb !== undefined && hb > 0 && ageSec !== undefined && ageSec > hb * DUE_GRACE;
    node.chainlink = {
      name: meta.name,
      heartbeatSec: hb,
      deviationPct: meta.deviationPct,
      feedCategory: meta.feedCategory,
      updatedAt: n.updatedAt,
      ageSec,
      due,
      sourceAddress: n.aggregator,
      priceText: n.priceText,
      lastMovePct: moveByAddr.get(lc(n.address)),
    };
    return node;
  });
  const edges = nodes.flatMap((n) => n.children.map((c) => ({ from: c, to: n.address })));

  return {
    chainId,
    name: chainName(chainId),
    generatedAt: new Date().toISOString(),
    markets: marketInfo(markets),
    nodes,
    edges,
    assets: dedupeAssets(listings),
    warnings,
  };
}

/** All nodes reachable from `leaf` (inclusive) — the self-contained path for one feed. */
export function closureFrom(allNodes: FeedNode[], leaf: string): FeedNode[] {
  const byAddr = new Map(allNodes.map((n) => [n.address.toLowerCase(), n]));
  const out: FeedNode[] = [];
  const seen = new Set<string>();
  const stack = [leaf.toLowerCase()];
  while (stack.length) {
    const a = stack.pop();
    if (!a || seen.has(a)) continue;
    seen.add(a);
    const n = byAddr.get(a);
    if (!n) continue;
    out.push(n);
    for (const c of n.children) stack.push(c.toLowerCase());
  }
  return out;
}
