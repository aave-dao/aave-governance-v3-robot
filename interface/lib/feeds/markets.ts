// Chain → markets registry, derived at module load from @aave-dao/aave-address-book.
//
// Two kinds of market feed the seed resolver (lib/feeds/seeds.ts):
//   - 'v3'        : an Aave V3 Pool + AaveOracle — assets & their sources are read on chain.
//   - 'v4-spoke'  : an Aave V4 spoke — its asset→feed map is published in the address book
//                   (SPOKE_PRICE_FEEDS); the feed *paths* are still probed on chain.

import type { Address } from 'viem';
import {
  AaveV3Ethereum,
  AaveV3EthereumLido,
  AaveV3EthereumEtherFi,
  AaveV3EthereumHorizon,
  AaveV3Polygon,
  AaveV3Avalanche,
  AaveV3Arbitrum,
  AaveV3Optimism,
  AaveV3Base,
  AaveV3Gnosis,
  AaveV3BNB,
  AaveV3Scroll,
  AaveV3Linea,
  AaveV3Sonic,
  AaveV3Metis,
  AaveV3Mantle,
  AaveV3Plasma,
  AaveV3Celo,
  AaveV3Soneium,
  AaveV3InkWhitelabel,
  AaveV3MegaEth,
  AaveV3XLayer,
  AaveV3Monad,
  AaveV4Ethereum,
  AaveV4Avalanche,
  AaveV4Base,
  AaveV4Arc,
} from '@aave-dao/aave-address-book';

export type Market =
  | { type: 'v3'; chainId: number; name: string; pool: Address; oracle: Address }
  | {
      type: 'v4-spoke';
      chainId: number;
      name: string;
      oracle?: Address;
      seeds: Record<string, Address>;
    };

type V3Mod = { CHAIN_ID: number; POOL: string; ORACLE: string };

// ---- V3 markets (same coverage as the reference config; extend by adding a row) ----
const V3_DEFS: Array<{ name: string; mod: V3Mod }> = [
  { name: 'V3 Core', mod: AaveV3Ethereum },
  { name: 'V3 Lido', mod: AaveV3EthereumLido },
  { name: 'V3 EtherFi', mod: AaveV3EthereumEtherFi },
  { name: 'V3 Horizon', mod: AaveV3EthereumHorizon },
  { name: 'V3', mod: AaveV3Polygon },
  { name: 'V3', mod: AaveV3Avalanche },
  { name: 'V3', mod: AaveV3Arbitrum },
  { name: 'V3', mod: AaveV3Optimism },
  { name: 'V3', mod: AaveV3Base },
  { name: 'V3', mod: AaveV3Gnosis },
  { name: 'V3', mod: AaveV3BNB },
  { name: 'V3', mod: AaveV3Scroll },
  { name: 'V3', mod: AaveV3Linea },
  { name: 'V3', mod: AaveV3Sonic },
  { name: 'V3', mod: AaveV3Metis },
  { name: 'V3', mod: AaveV3Mantle },
  { name: 'V3', mod: AaveV3Plasma },
  { name: 'V3', mod: AaveV3Celo },
  { name: 'V3', mod: AaveV3Soneium },
  { name: 'V3', mod: AaveV3InkWhitelabel },
  { name: 'V3', mod: AaveV3MegaEth },
  { name: 'V3', mod: AaveV3XLayer },
  { name: 'V3', mod: AaveV3Monad },
];

const V3_MARKETS: Market[] = V3_DEFS.map(({ name, mod }) => ({
  type: 'v3',
  chainId: mod.CHAIN_ID,
  name,
  pool: mod.POOL as Address,
  oracle: mod.ORACLE as Address,
}));

// ---- V4 spokes ----
type V4Mod = { CHAIN_ID: number; SPOKES: object; SPOKE_PRICE_FEEDS: object };

const V4_DEFS: V4Mod[] = [AaveV4Ethereum, AaveV4Avalanche, AaveV4Base, AaveV4Arc];

// SPOKES holds `<SPOKE>` + `<SPOKE>_ORACLE`; SPOKE_PRICE_FEEDS holds
// `<SPOKE>_<ASSET>_PRICE_FEED → feed`. Group the feed map back under each spoke.
function buildV4Markets(mod: V4Mod): Market[] {
  const spokes = mod.SPOKES as Record<string, string>;
  const feeds = mod.SPOKE_PRICE_FEEDS as Record<string, string>;
  const chainId = mod.CHAIN_ID;

  const spokeNames: string[] = [];
  const oracleBySpoke: Record<string, string> = {};
  for (const [k, v] of Object.entries(spokes)) {
    if (k.endsWith('_ORACLE')) oracleBySpoke[k.slice(0, -'_ORACLE'.length)] = v;
    else spokeNames.push(k);
  }
  // Longest first so `ETHENA_CORRELATED_SPOKE` wins over any shorter prefix.
  const sorted = [...spokeNames].sort((a, b) => b.length - a.length);

  const seedsBySpoke: Record<string, Record<string, Address>> = {};
  for (const [k, v] of Object.entries(feeds)) {
    if (!k.endsWith('_PRICE_FEED')) continue;
    const body = k.slice(0, -'_PRICE_FEED'.length); // e.g. MAIN_SPOKE_WETH
    const spoke = sorted.find((s) => body === s || body.startsWith(`${s}_`));
    if (!spoke) continue;
    const asset = body.slice(spoke.length).replace(/^_/, '') || spoke;
    (seedsBySpoke[spoke] ||= {})[asset] = v as Address;
  }

  const out: Market[] = [];
  for (const spoke of spokeNames) {
    const seeds = seedsBySpoke[spoke];
    if (!seeds || Object.keys(seeds).length === 0) continue;
    out.push({
      type: 'v4-spoke',
      chainId,
      name: `V4 ${spoke}`,
      oracle: oracleBySpoke[spoke] as Address | undefined,
      seeds,
    });
  }
  return out;
}
const V4_MARKETS = V4_DEFS.flatMap(buildV4Markets);

const ALL_MARKETS: Market[] = [...V3_MARKETS, ...V4_MARKETS];

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BNB Chain',
  100: 'Gnosis',
  137: 'Polygon',
  143: 'Monad',
  146: 'Sonic',
  196: 'X Layer',
  1088: 'Metis',
  1868: 'Soneium',
  4326: 'MegaETH',
  5000: 'Mantle',
  5042: 'Arc',
  8453: 'Base',
  9745: 'Plasma',
  42161: 'Arbitrum',
  42220: 'Celo',
  43114: 'Avalanche',
  57073: 'Ink',
  59144: 'Linea',
  534352: 'Scroll',
};

export const chainName = (chainId: number): string => CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;

export const marketsForChain = (chainId: number): Market[] =>
  ALL_MARKETS.filter((m) => m.chainId === chainId);

export const CHAIN_IDS: number[] = [...new Set(ALL_MARKETS.map((m) => m.chainId))].sort(
  (a, b) => a - b,
);

export type ChainSummary = { chainId: number; name: string; marketCount: number };

export const listChains = (): ChainSummary[] =>
  CHAIN_IDS.map((chainId) => ({
    chainId,
    name: chainName(chainId),
    marketCount: marketsForChain(chainId).length,
  }));
