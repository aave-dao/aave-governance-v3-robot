import type {Context} from '@tenderly/actions';
import type {Hex} from 'viem';

/**
 * Tenderly Web3 Actions don't expose `process.env` to the running function — they expose
 * `ctx.secrets`. Our `src/core/clients.ts` reads from `process.env` (so the same code path
 * works for the CLI). To bridge them, we copy the relevant secrets into `process.env` at the
 * top of every Tenderly Action invocation.
 *
 * Secrets to configure in Tenderly (UI or `tenderly actions secret set`):
 *   PRIVATE_KEY        Signer hex private key.
 *   ALCHEMY_API_KEY    (optional, recommended) Used for all chain RPCs.
 *   RPC_<NETWORK>      (optional) Per-chain override, e.g. RPC_MAINNET, RPC_POLYGON.
 */

const PRIVATE_KEY = 'PRIVATE_KEY';
const ALCHEMY_API_KEY = 'ALCHEMY_API_KEY';

/**
 * The full list of RPC_<NETWORK> names we may try to read. Mirrors @aave-dao/toolbox's
 * `getNetworkEnv()` outputs (sorted alphabetically). Anything we read here, we mirror into
 * process.env so that `getRpcUrl()` finds it.
 */
const RPC_ENV_NAMES = [
  'RPC_ARBITRUM',
  'RPC_AVALANCHE',
  'RPC_BASE',
  'RPC_BNB',
  'RPC_CELO',
  'RPC_GNOSIS',
  'RPC_INK',
  'RPC_LINEA',
  'RPC_MAINNET',
  'RPC_MANTLE',
  'RPC_MEGAETH',
  'RPC_METIS',
  'RPC_OPTIMISM',
  'RPC_PLASMA',
  'RPC_POLYGON',
  'RPC_SCROLL',
  'RPC_SONEIUM',
  'RPC_SONIC',
  'RPC_XLAYER',
  'RPC_ZKSYNC',
];

/**
 * Optional notification channel secrets. All optional — if none are configured the
 * notifier is a silent no-op. See src/core/notify.ts for the full channel-resolution rules.
 */
const NOTIFICATION_ENV_NAMES = [
  'SLACK_WEBHOOK_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'TELEGRAM_WEBHOOK_URL',
];

const trySecret = async (ctx: Context, key: string): Promise<string | undefined> => {
  try {
    return await ctx.secrets.get(key);
  } catch {
    return undefined;
  }
};

export type TenderlySecrets = {privateKey: Hex};

/**
 * Read PRIVATE_KEY (required) and copy ALCHEMY_API_KEY + any configured RPC_<NETWORK>
 * into `process.env` so subsequent calls to `getPublicClient()` / `getRpcUrl()` work.
 */
export const hydrateSecrets = async (ctx: Context): Promise<TenderlySecrets> => {
  const privateKey = (await ctx.secrets.get(PRIVATE_KEY)) as Hex;

  const alchemyKey = await trySecret(ctx, ALCHEMY_API_KEY);
  if (alchemyKey) process.env.ALCHEMY_API_KEY = alchemyKey;

  for (const name of RPC_ENV_NAMES) {
    const v = await trySecret(ctx, name);
    if (v) process.env[name] = v;
  }

  // Notification channels — all optional. Missing = no notifications, no error.
  for (const name of NOTIFICATION_ENV_NAMES) {
    const v = await trySecret(ctx, name);
    if (v) process.env[name] = v;
  }

  if (!process.env.ALCHEMY_API_KEY && !RPC_ENV_NAMES.some((n) => process.env[n])) {
    throw new Error(
      'No RPC source configured in Tenderly secrets. Set ALCHEMY_API_KEY or at least one RPC_<NETWORK>.',
    );
  }

  return {privateKey};
};
