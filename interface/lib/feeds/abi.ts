// ABIs + the probe function set used to fingerprint every feed/adapter on chain. Ported
// from tmp-ref/feed-graph.ts. The probe is deliberately a superset: we call every getter a
// known adapter type might expose with allowFailure, then `classify()` decides what the
// contract actually is from which calls succeeded.

import { parseAbi } from 'viem';

export const POOL_ABI = parseAbi([
  'function getReservesCount() view returns (uint256)',
  'function getReserveAddressById(uint16 id) view returns (address)',
]);

export const ORACLE_ABI = parseAbi([
  'function getSourceOfAsset(address asset) view returns (address)',
]);

export const ERC20_ABI = parseAbi(['function symbol() view returns (string)']);

export const FEED_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function DECIMALS() view returns (uint8)',
  'function description() view returns (string)',
  'function latestAnswer() view returns (int256)',
  'function source() view returns (address)',
  'function scale() view returns (bool, uint256)',
  'function ASSET_TO_USD_AGGREGATOR() view returns (address)',
  'function getPriceCap() view returns (int256)',
  'function MAX_STABLE_CAP_VALUE() view returns (int256)',
  'function BASE_TO_USD_AGGREGATOR() view returns (address)',
  'function RATIO_PROVIDER() view returns (address)',
  'function getSnapshotRatio() view returns (uint256)',
  'function getSnapshotTimestamp() view returns (uint256)',
  'function getMaxYearlyGrowthRatePercent() view returns (uint256)',
  'function MINIMUM_SNAPSHOT_DELAY() view returns (uint48)',
  'function MAXIMUM_SNAPSHOT_TERM() view returns (uint48)',
  'function RATIO_DECIMALS() view returns (uint8)',
  'function getRatio() view returns (int256)',
  'function isCapped() view returns (bool)',
  'function ONE_USD() view returns (int256)',
  'function price() view returns (int256)',
  'function ACL_MANAGER() view returns (address)',
  'function aggregator() view returns (address)',
  'function ASSET_TO_PEG() view returns (address)',
  'function PEG_TO_BASE() view returns (address)',
]);

export const PROBE_FNS = [
  'decimals', 'DECIMALS', 'description', 'latestAnswer', 'source', 'scale',
  'ASSET_TO_USD_AGGREGATOR', 'getPriceCap', 'MAX_STABLE_CAP_VALUE',
  'BASE_TO_USD_AGGREGATOR', 'RATIO_PROVIDER', 'getSnapshotRatio', 'getSnapshotTimestamp',
  'getMaxYearlyGrowthRatePercent', 'MINIMUM_SNAPSHOT_DELAY', 'MAXIMUM_SNAPSHOT_TERM',
  'RATIO_DECIMALS', 'getRatio', 'isCapped', 'ONE_USD', 'price', 'ACL_MANAGER',
  'aggregator', 'ASSET_TO_PEG', 'PEG_TO_BASE',
] as const;

export type ProbeFn = (typeof PROBE_FNS)[number];
export type Raw = Partial<Record<ProbeFn, unknown>>;

/** Canonical Multicall3 — same address on every chain that has it deployed. Passed
 *  explicitly to client.multicall() because getPublicClient() may build a synthetic chain
 *  (no multicall3 in its config) for chains absent from viem/chains (Monad, Plasma, …). */
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
