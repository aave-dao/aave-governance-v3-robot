import * as viemChains from 'viem/chains';
import type {Chain} from 'viem';

/**
 * Chain → tx explorer base URL. We use viem's `chain.blockExplorers.default.url` when
 * available (covers most mainstream chains). For chains viem doesn't carry — Plasma,
 * MegaETH, Sonic, XLayer in our deploy — we keep a small hardcoded fallback. Returns
 * `undefined` if no explorer is known so the notifier can fall back to a bare hash.
 */
const FALLBACK_EXPLORERS: Record<number, string> = {
  9745: 'https://plasmascan.to', // Plasma
  4326: 'https://www.megaexplorer.xyz', // MegaETH mainnet
  146: 'https://sonicscan.org', // Sonic
  196: 'https://www.oklink.com/xlayer', // X Layer
  1868: 'https://soneium.blockscout.com', // Soneium
  57073: 'https://explorer.inkonchain.com', // Ink
};

const viemChainByChainId = (chainId: number): Chain | undefined => {
  for (const v of Object.values(viemChains)) {
    if (v && typeof v === 'object' && 'id' in (v as object) && (v as Chain).id === chainId) {
      return v as Chain;
    }
  }
  return undefined;
};

/** Get the base explorer URL for a chain, or undefined if unknown. */
export const explorerBaseUrl = (chainId: number): string | undefined => {
  const fromViem = viemChainByChainId(chainId)?.blockExplorers?.default?.url;
  if (fromViem) return fromViem.replace(/\/$/, '');
  return FALLBACK_EXPLORERS[chainId];
};

/** Build a tx URL on the right explorer for `chainId`, or undefined if no explorer is known. */
export const txUrl = (chainId: number, txHash: string): string | undefined => {
  const base = explorerBaseUrl(chainId);
  return base ? `${base}/tx/${txHash}` : undefined;
};

/** First N + last M chars, separated by ellipsis — for compact display in messages. */
export const shortHash = (hash: string, head = 6, tail = 4): string =>
  hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
