// Shared types for the price-feed topology engine. Everything here is JSON-serializable
// (strings / numbers / arrays only — no bigint) so a ChainFeedGraph can cross the
// unstable_cache boundary and stream from a server component to the client unchanged.

/** A single key/value line rendered inside a feed node card. */
export type FeedRow = {
  k: string;
  v: string;
  /** Render the value in a monospace font (addresses, raw integers). */
  mono?: boolean;
  /** When set, the value is (or contains) this address — make it copyable / linkable. */
  addr?: string;
};

/** Official Chainlink config + live freshness for a leaf ChainlinkFeed node, merged from the
 *  Reference Data Directory and the on-chain latestTimestamp. */
export type ChainlinkMeta = {
  /** RDD feed name, e.g. "ETH / USD". */
  name?: string;
  /** Heartbeat (max seconds between updates). undefined = no heartbeat / unknown. */
  heartbeatSec?: number;
  /** Deviation threshold in percent (e.g. 0.5). */
  deviationPct?: number;
  /** RDD risk tier: low | medium | high | custom | new | deprecating. */
  feedCategory?: string;
  /** Unix seconds of the last on-chain update (latestTimestamp). */
  updatedAt?: number;
  /** Seconds since the last update at scan time. */
  ageSec?: number;
  /** True when the feed is overdue past its heartbeat (with a small grace) — "due for update". */
  due?: boolean;
};

/** One node in the feed dependency graph (a Chainlink leaf, a CAPO adapter, …). */
export type FeedNode = {
  /** Checksummed address — used for display, explorer links and as the canonical id. */
  address: string;
  /** 0x1234…abcd short form. */
  short: string;
  /** Classifier label: ChainlinkFeed | ScaledPriceAdapter | PriceCapAdapterStable | … */
  type: string;
  /** Hex color for the node's left border / legend dot. */
  color: string;
  /** On-chain parameters, already formatted to strings. */
  rows: FeedRow[];
  /** Checksummed addresses of the nodes this one reads from (its inputs). */
  children: string[];
  /** Distance (in edges) to the furthest leaf — used to lay the graph out in columns. */
  tier: number;
  /** Lowercased addresses referenced anywhere in this node (self + params) for search. */
  refs: string[];
  /** Set only on ChainlinkFeed leaves matched in the Reference Data Directory. */
  chainlink?: ChainlinkMeta;
};

export type MarketType = 'v3' | 'v4-spoke' | 'explicit';

/** A deduped price source for one asset on one chain. */
export type Feed = {
  /** Checksummed leaf address Aave consumes (root of the adapter path). */
  leaf: string;
  /** Markets that resolve THIS leaf for the asset (e.g. ['v3 Core', 'V4 MAIN_SPOKE']). */
  marketTags: string[];
};

/** A feed plus the self-contained closure of nodes reachable from its leaf — used by the
 *  cross-chain asset model where the chain-wide node map isn't carried alongside. */
export type FeedWithNodes = Feed & {
  nodes: FeedNode[];
};

/** All distinct price sources for a single asset symbol on a chain (deduped by leaf). */
export type AssetEntry = {
  symbol: string;
  feeds: Feed[];
};

export type MarketInfo = {
  name: string;
  type: MarketType;
  /** Spoke oracle (v4) or AaveOracle (v3) address, when applicable. */
  oracle?: string;
};

/** The full, cacheable topology for one chain. */
export type ChainFeedGraph = {
  chainId: number;
  name: string;
  /** ISO timestamp the snapshot was computed at. */
  generatedAt: string;
  markets: MarketInfo[];
  /** Every probed node (for the graph view). */
  nodes: FeedNode[];
  /** Directed edges source → consumer (for the graph view). */
  edges: { from: string; to: string }[];
  /** Deduped, symbol-sorted asset list (for the tree view). */
  assets: AssetEntry[];
  /** Non-fatal problems hit while scanning (markets that errored, etc.). */
  warnings: string[];
};

/** One chain's slice of an asset's cross-chain story. */
export type AssetChainEntry = {
  chainId: number;
  chainName: string;
  feeds: FeedWithNodes[];
};

/** How a single asset symbol is priced everywhere it's listed. */
export type AssetModelEntry = {
  symbol: string;
  chains: AssetChainEntry[];
};

// ---- cache tags ----
export const TAG_FEEDS_ALL = 'feeds:all';
export const chainTag = (chainId: number) => `feeds:chain:${chainId}`;
