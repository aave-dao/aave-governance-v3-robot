import type { PublicClient } from 'viem';
import { GOVERNANCE_CHAIN_ID, EXECUTION_CHAINS, VOTING_CHAINS, type VotingChainId } from '../core/chains';
import {
  accountFromPrivateKey,
  getPublicClient,
  getRpcUrl,
  getWalletClient,
} from '../core/clients';
import type { ReadContext, WriteContext } from '../core/context';
import type { Logger } from '../core/logger';
import { loadEnv, requirePrivateKey, type Env } from './env';

export const makeWriteContext = (
  env: Env,
  chainId: number,
  logger: Logger,
  chainName?: string,
): WriteContext => {
  const privateKey = requirePrivateKey(env);
  const publicClient = getPublicClient(chainId);
  const walletClient = getWalletClient(chainId, privateKey);
  return {
    chainId,
    publicClient,
    walletClient,
    account: accountFromPrivateKey(privateKey),
    logger: logger.child({ chainId, chain: chainName }),
  };
};

export const makeReadContext = (
  env: Env,
  chainId: number,
  logger: Logger,
  chainName?: string,
): ReadContext => ({
  chainId,
  publicClient: getPublicClient(chainId),
  logger: logger.child({ chainId, chain: chainName }),
});

/** Lazy factories for the inspector — only spin up clients for chains we have an RPC for. */
export const buildInspectorClients = (_env: Env) => {
  const govPublic = getPublicClient(GOVERNANCE_CHAIN_ID);

  const votingClients: Record<number, PublicClient> = {};
  for (const chainId of Object.keys(VOTING_CHAINS).map(Number) as VotingChainId[]) {
    try {
      votingClients[chainId] = getPublicClient(chainId);
    } catch {
      /* missing RPC for this chain — inspector tolerates it */
    }
  }

  const executionClients: Record<number, PublicClient> = {};
  for (const chainId of Object.keys(EXECUTION_CHAINS).map(Number)) {
    try {
      executionClients[chainId] = getPublicClient(chainId);
    } catch {
      /* missing RPC — inspector reports "unknown" for that payload */
    }
  }

  return { govPublic, votingClients, executionClients };
};

/** L1 RPC URL — used by storage-roots flow for eth_getProof / eth_getBlockByHash. */
export const ethRpcUrl = (_env: Env): string => getRpcUrl(GOVERNANCE_CHAIN_ID);
