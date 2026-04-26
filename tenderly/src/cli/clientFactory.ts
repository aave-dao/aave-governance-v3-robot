import type {PublicClient} from 'viem';
import {
  GOVERNANCE_CHAIN_ID,
  EXECUTION_CHAINS,
  VOTING_CHAINS,
  type VotingChainId,
} from '../core/chains';
import {
  accountFromPrivateKey,
  describeRpcSource,
  getPublicClient,
  getRpcUrl,
  getWalletClient,
} from '../core/clients';
import type {ReadContext, WriteContext} from '../core/context';
import type {Logger} from '../core/logger';
import {loadEnv, requirePrivateKey, type Env} from './env';

export const makeWriteContext = (
  env: Env,
  chainId: number,
  logger: Logger,
  chainName?: string,
): WriteContext => {
  const privateKey = requirePrivateKey(env);
  const child = logger.child({chainId, chain: chainName});
  const url = getRpcUrl(chainId);
  child.debug('rpc resolved', {source: describeRpcSource(chainId, url)});
  const account = accountFromPrivateKey(privateKey);
  child.trace('write context built', {account});
  return {
    chainId,
    publicClient: getPublicClient(chainId),
    walletClient: getWalletClient(chainId, privateKey),
    account,
    logger: child,
  };
};

export const makeReadContext = (
  env: Env,
  chainId: number,
  logger: Logger,
  chainName?: string,
): ReadContext => {
  const child = logger.child({chainId, chain: chainName});
  const url = getRpcUrl(chainId);
  child.debug('rpc resolved', {source: describeRpcSource(chainId, url)});
  return {
    chainId,
    publicClient: getPublicClient(chainId),
    logger: child,
  };
};

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

  return {govPublic, votingClients, executionClients};
};

/** L1 RPC URL — used by storage-roots flow for eth_getProof / eth_getBlockByHash. */
export const ethRpcUrl = (_env: Env): string => getRpcUrl(GOVERNANCE_CHAIN_ID);
