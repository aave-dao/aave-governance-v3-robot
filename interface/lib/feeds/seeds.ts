// Seed resolution: turn each market into a list of (symbol → leaf feed) listings.
//
//   - v3       : read Pool.getReservesCount()/getReserveAddressById() + Oracle.getSourceOfAsset()
//                + ERC20.symbol(), all on chain.
//   - v4-spoke / explicit : the asset→feed map is already known (address book / curated).
//
// `leaf` is the address Aave actually consumes for the asset — the root of the adapter path.

import type { Address, PublicClient } from 'viem';
import { ERC20_ABI, MULTICALL3, ORACLE_ABI, POOL_ABI } from './abi';
import { ZERO } from './format';
import type { Market } from './markets';
import type { MarketType } from './types';

export type Listing = {
  marketName: string;
  marketType: MarketType;
  symbol: string;
  /** lowercased leaf feed address */
  leaf: Address;
};

const lc = (a: string) => a.toLowerCase() as Address;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function resolveV3Market(
  client: PublicClient,
  market: Extract<Market, { type: 'v3' }>,
): Promise<Listing[]> {
  const count = Number(
    await client.readContract({
      address: market.pool,
      abi: POOL_ABI,
      functionName: 'getReservesCount',
    }),
  );
  if (!count) return [];

  const ids = Array.from({ length: count }, (_, i) => i);
  const assetRes = (await client.multicall({
    contracts: ids.map((i) => ({
      address: market.pool,
      abi: POOL_ABI,
      functionName: 'getReserveAddressById',
      args: [i],
    })) as never,
    allowFailure: true,
    multicallAddress: MULTICALL3,
  })) as Array<{ status: string; result?: unknown }>;
  const assets = assetRes
    .map((r) => (r.status === 'success' ? (r.result as Address) : null))
    .filter((a): a is Address => !!a && lc(a) !== ZERO);

  const calls = assets.flatMap((a) => [
    { address: market.oracle, abi: ORACLE_ABI, functionName: 'getSourceOfAsset', args: [a] },
    { address: a, abi: ERC20_ABI, functionName: 'symbol' },
  ]);
  const res = (await client.multicall({
    contracts: calls as never,
    allowFailure: true,
    multicallAddress: MULTICALL3,
  })) as Array<{ status: string; result?: unknown }>;

  const listings: Listing[] = [];
  assets.forEach((a, i) => {
    const srcRes = res[i * 2];
    const symRes = res[i * 2 + 1];
    const src = srcRes && srcRes.status === 'success' ? (srcRes.result as Address) : null;
    const sym = symRes && symRes.status === 'success' ? (symRes.result as string) : short(a);
    if (src && lc(src) !== ZERO) {
      listings.push({
        marketName: market.name,
        marketType: 'v3',
        symbol: sym || short(a),
        leaf: lc(src),
      });
    }
  });
  return listings;
}

function resolveMappedMarket(
  market: Extract<Market, { type: 'v4-spoke' | 'explicit' }>,
): Listing[] {
  const listings: Listing[] = [];
  for (const [symbol, addr] of Object.entries(market.seeds)) {
    if (!addr || lc(addr) === ZERO) continue;
    listings.push({ marketName: market.name, marketType: market.type, symbol, leaf: lc(addr) });
  }
  return listings;
}

/** Resolve every market on a chain into listings. Market-level failures are collected as
 *  warnings rather than aborting the whole chain. */
export async function resolveListings(
  client: PublicClient,
  markets: Market[],
): Promise<{ listings: Listing[]; warnings: string[] }> {
  const listings: Listing[] = [];
  const warnings: string[] = [];

  for (const market of markets) {
    try {
      if (market.type === 'v3') {
        listings.push(...(await resolveV3Market(client, market)));
      } else {
        listings.push(...resolveMappedMarket(market));
      }
    } catch (err) {
      warnings.push(
        `market "${market.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { listings, warnings };
}
