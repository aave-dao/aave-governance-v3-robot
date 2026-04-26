import type { Context } from '@tenderly/actions';
import { accountFromPrivateKey, getPublicClient, getRpcUrl, getWalletClient } from '../core/clients';
import type { ReadContext, WriteContext } from '../core/context';
import { createLogger, type Logger } from '../core/logger';
import { GOVERNANCE_CHAIN_ID } from '../core/chains';
import { hydrateSecrets } from './secrets';

const tenderlyLogger = (): Logger =>
  createLogger('info', (line) => {
    // eslint-disable-next-line no-console
    console.log(line);
  });

export type ChainSetup = {
  read: ReadContext;
  write: WriteContext;
  ethRpcUrl: string;
  logger: Logger;
};

/**
 * Single setup helper for Tenderly actions: hydrate secrets into process.env, then build the
 * read/write contexts via the same factories the CLI uses.
 */
export const setupChain = async (ctx: Context, chainId: number, chainName?: string): Promise<ChainSetup> => {
  const { privateKey } = await hydrateSecrets(ctx);
  const baseLogger = tenderlyLogger().child({ chainId, chain: chainName });
  const publicClient = getPublicClient(chainId);
  const walletClient = getWalletClient(chainId, privateKey);
  const account = accountFromPrivateKey(privateKey);
  return {
    read: { chainId, publicClient, logger: baseLogger },
    write: { chainId, publicClient, walletClient, account, logger: baseLogger },
    ethRpcUrl: getRpcUrl(GOVERNANCE_CHAIN_ID),
    logger: baseLogger,
  };
};
