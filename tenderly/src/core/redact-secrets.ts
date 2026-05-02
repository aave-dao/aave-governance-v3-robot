// Strip API keys / tokens out of any user-visible string before it lands in a notification,
// the inspector report, or a thrown error. RPC errors from viem regularly include the full
// provider URL (e.g. https://eth-mainnet.g.alchemy.com/v2/<KEY>) which would otherwise leak
// the key into Slack/Telegram alerts and serialized inspector output.

const URL_PATTERNS: Array<[RegExp, string]> = [
  // Alchemy
  [/(https?:\/\/[a-z0-9.-]+\.g\.alchemy\.com\/v2\/)[A-Za-z0-9_-]+/gi, '$1<redacted>'],
  [/(https?:\/\/[a-z0-9.-]+\.alchemyapi\.io\/v2\/)[A-Za-z0-9_-]+/gi, '$1<redacted>'],
  // Infura
  [/(https?:\/\/[a-z0-9.-]+\.infura\.io\/v3\/)[A-Za-z0-9_-]+/gi, '$1<redacted>'],
  // QuickNode (path-style key)
  [/(https?:\/\/[a-z0-9.-]+\.quiknode\.pro\/)[A-Za-z0-9_-]+/gi, '$1<redacted>'],
  // BlockPI
  [/(https?:\/\/[a-z0-9.-]+\.blockpi\.network\/v1\/rpc\/private\/)[A-Za-z0-9_-]+/gi, '$1<redacted>'],
  // dRPC
  [/(https?:\/\/[a-z0-9.-]+\.drpc\.org\/[^\s"<>?]*[?&]dkey=)[A-Za-z0-9_-]+/gi, '$1<redacted>'],
  // Ankr (premium)
  [/(https?:\/\/rpc\.ankr\.com\/[a-z0-9_-]+\/)[A-Za-z0-9_-]+/gi, '$1<redacted>'],
];

// Generic URL query-string secrets — covers anything we missed above.
const QUERY_PATTERNS: Array<[RegExp, string]> = [
  [/([?&](?:api[_-]?key|apikey|key|token|secret|auth)=)[^&\s"<>]+/gi, '$1<redacted>'],
];

const ENV_KEYS_TO_SCRUB = [
  'ALCHEMY_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'CRON_SECRET',
  'DATABASE_URL',
];

const isLongOpaque = (s: string) => s.length >= 16 && /^[A-Za-z0-9_-]+$/.test(s);

/**
 * Returns a copy of `text` with API keys / tokens replaced by `<redacted>`.
 * Combines URL pattern matching with literal env-value substitution so even
 * unusual provider URL shapes (or bare keys logged out of context) get caught.
 */
export const redactSecrets = (text: string): string => {
  if (!text) return text;
  let out = text;

  // 1. Substitute literal env values first (they're the most reliable source of truth).
  //    Also redact any RPC_<NETWORK> env values that include opaque tokens.
  for (const [k, v] of Object.entries(process.env)) {
    if (!v) continue;
    if (!ENV_KEYS_TO_SCRUB.includes(k) && !k.startsWith('RPC_')) continue;
    if (!isLongOpaque(v) && !v.startsWith('http')) continue;
    // Replace exact matches; escape regex metacharacters in v.
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), '<redacted>');
  }

  // 2. URL-shape patterns for common providers.
  for (const [re, repl] of URL_PATTERNS) {
    out = out.replace(re, repl);
  }

  // 3. Generic query-string keys.
  for (const [re, repl] of QUERY_PATTERNS) {
    out = out.replace(re, repl);
  }

  return out;
};
