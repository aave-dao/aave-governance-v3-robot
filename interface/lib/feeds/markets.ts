// Chain → markets registry, derived at module load from @aave-dao/aave-address-book.
//
// Three kinds of market feed the seed resolver (lib/feeds/seeds.ts):
//   - 'v3'        : an Aave V3 Pool + AaveOracle — assets & their sources are read on chain.
//   - 'v4-spoke'  : an Aave V4 spoke — its asset→feed map is published in the address book
//                   (SPOKE_PRICE_FEEDS); the feed *paths* are still probed on chain.
//   - 'explicit'  : a hand-curated asset→feed map (Monad, whose adapters are deployed but
//                   not all wired into an oracle yet — mirrors the reference tool).

import type { Address } from 'viem';
import {
  AaveV3Ethereum,
  AaveV3EthereumLido,
  AaveV3EthereumEtherFi,
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
  AaveV4Ethereum,
} from '@aave-dao/aave-address-book';

export type Market =
  | { type: 'v3'; chainId: number; name: string; pool: Address; oracle: Address }
  | {
      type: 'v4-spoke';
      chainId: number;
      name: string;
      oracle?: Address;
      seeds: Record<string, Address>;
    }
  | { type: 'explicit'; chainId: number; name: string; seeds: Record<string, Address> };

type V3Mod = { CHAIN_ID: number; POOL: string; ORACLE: string };

// ---- V3 markets (same coverage as the reference config; extend by adding a row) ----
const V3_DEFS: Array<{ name: string; mod: V3Mod }> = [
  { name: 'V3 Core', mod: AaveV3Ethereum },
  { name: 'V3 Lido', mod: AaveV3EthereumLido },
  { name: 'V3 EtherFi', mod: AaveV3EthereumEtherFi },
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
];

const V3_MARKETS: Market[] = V3_DEFS.map(({ name, mod }) => ({
  type: 'v3',
  chainId: mod.CHAIN_ID,
  name,
  pool: mod.POOL as Address,
  oracle: mod.ORACLE as Address,
}));

// ---- V4 Ethereum spokes ----
// SPOKES holds `<SPOKE>` + `<SPOKE>_ORACLE`; SPOKE_PRICE_FEEDS holds
// `<SPOKE>_<ASSET>_PRICE_FEED → feed`. Group the feed map back under each spoke.
function buildV4Markets(): Market[] {
  const spokes = AaveV4Ethereum.SPOKES as Record<string, string>;
  const feeds = AaveV4Ethereum.SPOKE_PRICE_FEEDS as Record<string, string>;
  const chainId = AaveV4Ethereum.CHAIN_ID;

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
const V4_MARKETS = buildV4Markets();

// ---- Monad (explicit): deployed leaf adapters consumed by Aave per asset ----
const MONAD_ASSETS: Record<string, Address> = {
  WETH: '0x47F1D18329Ae59341617B7a5BE59605B63f0e373',
  cbBTC: '0x48692d15DA2636E1b0335344104Ce9d92f231DdA',
  MON: '0x11fEb287b8dd9A184F47c890B11B8385AD191670',
  USDT: '0x3c187a25f0f05E009DA794069682653e40062730',
  USDC: '0x787962943811D279d01eC973Bd3A15f1b3e1F0D9',
  AUSD: '0x6b7c151653c35845a5826b15435fc055A9Db1D0C',
  USDe: '0x3abA25B23378A84FD7638E20F9Af86A66000f090',
  GHO: '0x26cBccD96502D2EfDb612737bD6aECe19f65109c',
  mUSD: '0xbbb58AA3a251c9f19653771c44481c39500b71A3',
  wstETH: '0x7c1DbD7879C421ebd1A2dE397Ea6Bedb5D3795A5',
  weETH: '0x53E2d62Cd8c36104DEC69bA0CB3Bb599d6D42FE1',
  sUSDe: '0x99946fe1a49d8650a31efe0fcfee0508892742f0',
  syrupUSDC: '0xB1f36c815761a3F77CE26c013F646cdCdCd06384',
};
const MONAD_MARKET: Market = {
  type: 'explicit',
  chainId: 143,
  name: 'Monad adapters',
  seeds: MONAD_ASSETS,
};

const ALL_MARKETS: Market[] = [...V3_MARKETS, ...V4_MARKETS, MONAD_MARKET];

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BNB Chain',
  100: 'Gnosis',
  137: 'Polygon',
  143: 'Monad',
  146: 'Sonic',
  1088: 'Metis',
  5000: 'Mantle',
  8453: 'Base',
  9745: 'Plasma',
  42161: 'Arbitrum',
  42220: 'Celo',
  43114: 'Avalanche',
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
