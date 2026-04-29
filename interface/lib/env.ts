import 'server-only';
import type { Hex } from 'viem';
import { z } from 'zod';

const HexKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'PRIVATE_KEY must be a 0x-prefixed 32-byte hex string')
  .transform((s) => s as Hex);

const Schema = z
  .object({
    PRIVATE_KEY: HexKey,
    ALCHEMY_API_KEY: z.string().optional(),
    DATABASE_URL: z.string().min(1),
    CRON_SECRET: z.string().min(8),
    SLACK_WEBHOOK_URL: z.string().url().optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_CHAT_ID: z.string().optional(),
    TELEGRAM_WEBHOOK_URL: z.string().url().optional(),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  })
  .passthrough();

export type ServerEnv = z.infer<typeof Schema>;

let cached: ServerEnv | undefined;

export const loadServerEnv = (): ServerEnv => {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n  ');
    throw new Error(`invalid environment:\n  ${issues}`);
  }
  const env = parsed.data;
  const hasExplicitRpc = Object.keys(process.env).some((k) => k.startsWith('RPC_'));
  if (!env.ALCHEMY_API_KEY && !hasExplicitRpc) {
    throw new Error(
      'No RPC source configured. Set ALCHEMY_API_KEY or at least one RPC_<NETWORK>.',
    );
  }
  cached = env;
  return env;
};

export const requirePrivateKey = (): Hex => loadServerEnv().PRIVATE_KEY;
