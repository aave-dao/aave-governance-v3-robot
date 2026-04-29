// Client-safe re-export wrapper around @robot/core/explorers.
// The underlying module uses viem's chain registry which is universal (no node-only deps).
import { addressUrl, txUrl } from '@robot/core/explorers';

export const txExplorerUrl = (chainId: number, txHash: string): string | null =>
  txUrl(chainId, txHash) ?? null;

export const addressExplorerUrl = (chainId: number, address: string): string | null =>
  addressUrl(chainId, address) ?? null;
