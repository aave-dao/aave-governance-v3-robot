// Classify a probed contract into a typed feed node. Ported (near-verbatim) from
// tmp-ref/feed-graph.ts. Given the map of which probe calls succeeded, infer the adapter
// type and pull out its parameters + the child feeds it reads from.

import { getAddress, type Address } from 'viem';
import type { Raw } from './abi';
import { colorFor, fmtDays, fmtPct, fmtRatio, fmtTs, fmtUsd, short, ZERO } from './format';
import type { FeedRow } from './types';

/** Classifier output before tiering — children are lowercased addresses for graph wiring. */
export type ClassifiedNode = {
  address: string; // checksummed
  short: string;
  type: string;
  color: string;
  children: Address[]; // lowercased
  rows: FeedRow[];
  refs: string[]; // lowercased (self + referenced addresses)
};

const lc = (a: string) => a.toLowerCase() as Address;
const optLc = (v: unknown): Address | null =>
  typeof v === 'string' && v.startsWith('0x') ? lc(v) : null;
const sh = (v: unknown): string => (typeof v === 'string' ? short(v) : 'n/a');

export function classify(addr: Address, raw: Raw): ClassifiedNode {
  const dec = Number((raw.decimals ?? raw.DECIMALS ?? 8n) as bigint);
  const desc = (raw.description as string) ?? '(no description)';
  const la = raw.latestAnswer as bigint | undefined;
  const laRow = (d = dec): FeedRow => ({
    k: 'latestAnswer',
    v: la !== undefined ? `${fmtUsd(la, d)}  (${la})` : 'n/a',
  });
  const base = { address: getAddress(addr), short: short(getAddress(addr)) };
  const refs = [
    ...new Set([
      lc(addr),
      ...Object.values(raw)
        .filter((v): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v))
        .map((v) => lc(v)),
    ]),
  ];
  const mk = (type: string, children: Address[], rows: FeedRow[]): ClassifiedNode => ({
    ...base,
    type,
    color: colorFor(type),
    children: children.filter((c) => c && lc(c) !== ZERO),
    rows,
    refs,
  });

  if (raw.source !== undefined && raw.scale !== undefined) {
    const [up, factor] = raw.scale as [boolean, bigint];
    return mk('ScaledPriceAdapter', [optLc(raw.source)].filter(Boolean) as Address[], [
      { k: 'description', v: desc },
      { k: 'decimals', v: String(dec) },
      {
        k: 'scaling',
        v: `${up ? 'UP ×' : 'DOWN ÷'}${factor.toString()} (1e${BigInt(factor).toString().length - 1})`,
      },
      laRow(),
      { k: 'source', v: sh(raw.source), mono: true, addr: raw.source as string },
    ]);
  }
  if (raw.BASE_TO_USD_AGGREGATOR !== undefined && raw.getSnapshotRatio !== undefined) {
    const rdec = Number((raw.RATIO_DECIMALS ?? 18n) as bigint);
    return mk(
      'CLRatePriceCapAdapter',
      [optLc(raw.BASE_TO_USD_AGGREGATOR), optLc(raw.RATIO_PROVIDER)].filter(Boolean) as Address[],
      [
        { k: 'description', v: desc },
        { k: 'decimals', v: String(dec) },
        {
          k: 'base feed',
          v: sh(raw.BASE_TO_USD_AGGREGATOR),
          mono: true,
          addr: raw.BASE_TO_USD_AGGREGATOR as string,
        },
        {
          k: 'ratio provider',
          v: sh(raw.RATIO_PROVIDER),
          mono: true,
          addr: raw.RATIO_PROVIDER as string,
        },
        { k: 'ratio decimals', v: String(rdec) },
        {
          k: 'snapshotRatio',
          v: `${fmtRatio(raw.getSnapshotRatio as bigint, rdec)}  (${raw.getSnapshotRatio})`,
        },
        { k: 'snapshotTimestamp', v: fmtTs(raw.getSnapshotTimestamp as bigint) },
        { k: 'maxYearlyGrowth', v: fmtPct(raw.getMaxYearlyGrowthRatePercent as bigint) },
        { k: 'minSnapshotDelay', v: fmtDays(raw.MINIMUM_SNAPSHOT_DELAY as bigint) },
        { k: 'maxSnapshotTerm', v: fmtDays(raw.MAXIMUM_SNAPSHOT_TERM as bigint) },
        { k: 'live ratio', v: `${fmtRatio(raw.getRatio as bigint, rdec)}  (${raw.getRatio})` },
        { k: 'isCapped', v: String(raw.isCapped) },
        laRow(),
        { k: 'ACL_MANAGER', v: sh(raw.ACL_MANAGER), mono: true, addr: raw.ACL_MANAGER as string },
      ],
    );
  }
  if (raw.ASSET_TO_USD_AGGREGATOR !== undefined && raw.getPriceCap !== undefined) {
    const cap = raw.getPriceCap as bigint;
    return mk(
      'PriceCapAdapterStable',
      [optLc(raw.ASSET_TO_USD_AGGREGATOR)].filter(Boolean) as Address[],
      [
        { k: 'description', v: desc },
        { k: 'decimals', v: String(dec) },
        {
          k: 'asset feed',
          v: sh(raw.ASSET_TO_USD_AGGREGATOR),
          mono: true,
          addr: raw.ASSET_TO_USD_AGGREGATOR as string,
        },
        { k: 'priceCap', v: `${fmtUsd(cap, dec)}  (${cap})` },
        {
          k: 'MAX_STABLE_CAP',
          v:
            raw.MAX_STABLE_CAP_VALUE !== undefined
              ? fmtUsd(raw.MAX_STABLE_CAP_VALUE as bigint, dec)
              : 'n/a',
        },
        laRow(),
        { k: 'isCapped', v: String(raw.isCapped) },
        { k: 'ACL_MANAGER', v: sh(raw.ACL_MANAGER), mono: true, addr: raw.ACL_MANAGER as string },
      ],
    );
  }
  if (raw.ASSET_TO_PEG !== undefined && raw.PEG_TO_BASE !== undefined) {
    return mk(
      'CLSynchronicityPegToBase',
      [optLc(raw.ASSET_TO_PEG), optLc(raw.PEG_TO_BASE)].filter(Boolean) as Address[],
      [
        { k: 'description', v: desc },
        { k: 'decimals', v: String(dec) },
        {
          k: 'asset/peg feed',
          v: sh(raw.ASSET_TO_PEG),
          mono: true,
          addr: raw.ASSET_TO_PEG as string,
        },
        {
          k: 'peg/base feed',
          v: sh(raw.PEG_TO_BASE),
          mono: true,
          addr: raw.PEG_TO_BASE as string,
        },
        laRow(),
      ],
    );
  }
  if (raw.ONE_USD !== undefined) {
    return mk('OneUSDFixedAdapter', [], [
      { k: 'description', v: desc },
      { k: 'decimals', v: String(dec) },
      laRow(),
    ]);
  }
  if (raw.price !== undefined && raw.ACL_MANAGER !== undefined) {
    return mk('FixedPriceAdapter', [], [
      { k: 'description', v: desc },
      { k: 'decimals', v: String(dec) },
      { k: 'price', v: `${fmtUsd(raw.price as bigint, dec)}  (${raw.price})` },
      laRow(),
      { k: 'ACL_MANAGER', v: sh(raw.ACL_MANAGER), mono: true, addr: raw.ACL_MANAGER as string },
    ]);
  }
  // raw Chainlink aggregator/proxy (or unknown adapter) — generic leaf
  const isRate = desc.toLowerCase().includes('exchange rate');
  const kind = isRate
    ? 'Chainlink exchange-rate feed'
    : 'Chainlink price feed' + (dec === 18 ? ' (18-dec / SVR)' : '');
  const rows: FeedRow[] = [
    { k: 'kind', v: kind },
    { k: 'description', v: desc },
    { k: 'decimals', v: String(dec) },
    {
      k: 'latestAnswer',
      v: la !== undefined ? `${isRate ? fmtRatio(la, dec) : fmtUsd(la, dec)}  (${la})` : 'n/a',
    },
  ];
  if (raw.aggregator !== undefined)
    rows.push({ k: 'aggregator', v: sh(raw.aggregator), mono: true, addr: raw.aggregator as string });
  return mk('ChainlinkFeed', [], rows);
}
