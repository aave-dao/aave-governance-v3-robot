import {
  buildInspectorClients,
  ethRpcUrl as cliEthRpcUrl,
  makeReadContext,
  makeWriteContext,
} from '@robot/cli/clientFactory';
import { loadEnv as loadCliEnv } from '@robot/cli/env';
import type { ReadContext, WriteContext } from '@robot/core/context';
import { getLogger } from './logger';
import { loadServerEnv } from './env';

// Bridge: ensure env is validated by our schema first, then delegate to the CLI helpers
// (which read directly from process.env via @bgd-labs/toolbox).
const ensureEnv = () => {
  loadServerEnv();
  return loadCliEnv();
};

export const makeWriteContextFromEnv = (
  chainId: number,
  chainName?: string,
): WriteContext => makeWriteContext(ensureEnv(), chainId, getLogger(), chainName);

export const makeReadContextFromEnv = (
  chainId: number,
  chainName?: string,
): ReadContext => makeReadContext(ensureEnv(), chainId, getLogger(), chainName);

export const buildInspectorClientsFromEnv = () => {
  const env = ensureEnv();
  return { ...buildInspectorClients(env), logger: getLogger() };
};

export const ethRpcUrlFromEnv = (): string => cliEthRpcUrl(ensureEnv());
