import type {Context} from '@tenderly/actions';
import {
  accountFromPrivateKey,
  candidateUrls,
  describeRpcSource,
  getPublicClient,
  getRpcUrl,
  getWalletClient,
} from '../core/clients';
import type {ReadContext, WriteContext} from '../core/context';
import {createLogger, type Logger} from '../core/logger';
import {GOVERNANCE_CHAIN_ID} from '../core/chains';
import {hydrateSecrets} from './secrets';

/**
 * Tenderly's runtime sets `LOG_LEVEL` so we can crank up verbosity from the dashboard
 * without redeploying. Falls back to `info` if unset.
 */
const RESOLVED_LEVEL = (() => {
  const v = process.env.LOG_LEVEL?.toLowerCase();
  if (v === 'trace' || v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v;
  return 'info' as const;
})();

export const tenderlyLogger = (): Logger =>
  createLogger(RESOLVED_LEVEL, (line) => {
    // eslint-disable-next-line no-console
    console.log(line);
  });

export type ChainSetup = {
  read: ReadContext;
  write: WriteContext;
  ethRpcUrls: string[];
  logger: Logger;
};

/**
 * Single setup helper for Tenderly actions: hydrate secrets into process.env, then build the
 * read/write contexts via the same factories the CLI uses.
 */
export const setupChain = async (
  ctx: Context,
  chainId: number,
  chainName?: string,
): Promise<ChainSetup> => {
  const {privateKey} = await hydrateSecrets(ctx);
  const baseLogger = tenderlyLogger().child({chainId, chain: chainName});
  const url = getRpcUrl(chainId);
  baseLogger.debug('rpc resolved', {source: describeRpcSource(chainId, url)});
  const publicClient = getPublicClient(chainId);
  const walletClient = getWalletClient(chainId, privateKey);
  const account = accountFromPrivateKey(privateKey);
  baseLogger.trace('chain setup complete', {account});
  return {
    read: {chainId, publicClient, logger: baseLogger},
    write: {chainId, publicClient, walletClient, account, logger: baseLogger},
    ethRpcUrls: candidateUrls(GOVERNANCE_CHAIN_ID),
    logger: baseLogger,
  };
};
