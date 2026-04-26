import 'dotenv/config';
import type { Hex } from 'viem';
import { z } from 'zod';

const HexKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'PRIVATE_KEY must be a 0x-prefixed 32-byte hex string')
  .transform((s) => s as Hex);

/**
 * RPC config follows the @bgd-labs/toolbox convention used across BGD scripts:
 *   - `ALCHEMY_API_KEY` builds RPC URLs for all toolbox-supported chains.
 *   - `RPC_<NETWORK>` (e.g. RPC_MAINNET, RPC_POLYGON) overrides per chain.
 *   - Falls back to public RPC for the chain if neither is set.
 *
 * `getPublicClient(chainId)` / `getRpcUrl(chainId)` in src/core/clients.ts pick these up
 * directly from `process.env`, so we don't enumerate them in the schema. We still validate
 * that *some* RPC source is configured.
 */
const EnvSchema = z
  .object({
    PRIVATE_KEY: HexKey.optional(),
    ALCHEMY_API_KEY: z.string().optional(),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  })
  .passthrough(); // tolerate any RPC_<NETWORK>=… lines in .env

export type Env = z.infer<typeof EnvSchema>;

export const loadEnv = (): Env => {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`invalid environment:\n  ${issues}`);
  }
  const env = parsed.data;
  const hasExplicitRpc = Object.keys(process.env).some((k) => k.startsWith('RPC_'));
  if (!env.ALCHEMY_API_KEY && !hasExplicitRpc) {
    throw new Error(
      'No RPC source configured. Set ALCHEMY_API_KEY or at least one RPC_<NETWORK> (e.g. RPC_MAINNET) in .env.',
    );
  }
  return env;
};

export const requirePrivateKey = (env: Env): Hex => {
  if (!env.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY missing — set it in .env to send transactions');
  }
  return env.PRIVATE_KEY;
};
