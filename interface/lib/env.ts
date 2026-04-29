import type { Hex } from 'viem';
import { z } from 'zod';

const HexKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'PRIVATE_KEY must be a 0x-prefixed 32-byte hex string')
  .transform((s) => s as Hex);

// Treat empty strings (common in .env files) as "not set". Zod `.url().optional()` would
// otherwise reject `KEY=` lines.
const optionalUrl = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().url().optional(),
);
const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().optional(),
);

const Schema = z
  .object({
    PRIVATE_KEY: HexKey,
    ALCHEMY_API_KEY: optionalString,
    DATABASE_URL: z.string().min(1),
    CRON_SECRET: z.string().min(8),
    SLACK_WEBHOOK_URL: optionalUrl,
    TELEGRAM_BOT_TOKEN: optionalString,
    TELEGRAM_CHAT_ID: optionalString,
    TELEGRAM_WEBHOOK_URL: optionalUrl,
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
