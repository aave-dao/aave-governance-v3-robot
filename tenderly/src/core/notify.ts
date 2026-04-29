import type {Logger} from './logger';
import {explorerBaseUrl, shortHash, txUrl} from './explorers';

/**
 * Out-of-band notifications for the robot. Reads channel config from `process.env` on
 * every call (Tenderly hydrates secrets into the environment before the action body
 * runs, so reading at call-time is correct). All channel POSTs are best-effort — a
 * failure logs at `warn` and does NOT propagate.
 *
 * Channels:
 *   - Slack: SLACK_WEBHOOK_URL (incoming webhook URL)
 *   - Telegram (auto-detect):
 *       - TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  (canonical bot API, preferred)
 *       - TELEGRAM_WEBHOOK_URL                    (opaque relay — POST {text})
 *   - If none configured: this module is a silent no-op.
 */

const REQUEST_TIMEOUT_MS = 5_000;

/** Internal: post one Slack-flavored message. */
const postSlack = async (text: string, logger?: Logger): Promise<void> => {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({text}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) logger?.warn('notify: slack non-2xx', {status: res.status});
  } catch (err) {
    logger?.warn('notify: slack post failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

/** Internal: post one Telegram message via bot API or opaque relay. */
const postTelegram = async (
  htmlText: string,
  plainText: string,
  logger?: Logger,
): Promise<void> => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const relayUrl = process.env.TELEGRAM_WEBHOOK_URL;

  if (botToken && chatId) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) logger?.warn('notify: telegram non-2xx', {status: res.status});
    } catch (err) {
      logger?.warn('notify: telegram post failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (relayUrl) {
    try {
      const res = await fetch(relayUrl, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({text: plainText}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) logger?.warn('notify: telegram relay non-2xx', {status: res.status});
    } catch (err) {
      logger?.warn('notify: telegram relay failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};

const fanOut = async (
  slackText: string,
  telegramHtml: string,
  plainText: string,
  logger?: Logger,
): Promise<void> => {
  await Promise.allSettled([
    postSlack(slackText, logger),
    postTelegram(telegramHtml, plainText, logger),
  ]);
};

const chainLabel = (chainId: number, chainName?: string): string => chainName ?? `chain-${chainId}`;

const renderMeta = (meta?: Record<string, unknown>): {plain: string; slack: string; tg: string} => {
  if (!meta) return {plain: '', slack: '', tg: ''};
  const entries = Object.entries(meta).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return {plain: '', slack: '', tg: ''};
  const lines = entries.map(([k, v]) => {
    const value = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return {k, value};
  });
  return {
    plain: lines.map((l) => `${l.k}: ${l.value}`).join('\n'),
    slack: lines.map((l) => `${l.k}: \`${l.value}\``).join('\n'),
    tg: lines.map((l) => `${l.k}: <code>${escapeHtml(l.value)}</code>`).join('\n'),
  };
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Marker placed on errors so the outer wrapper can dedupe re-notification. */
const NOTIFIED_AT = Symbol.for('aave-gov-robot.notified');

const isAlreadyNotified = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as {[k: symbol]: unknown})[NOTIFIED_AT] === true;

const markNotified = (err: unknown): void => {
  if (typeof err === 'object' && err !== null) {
    try {
      (err as {[k: symbol]: unknown})[NOTIFIED_AT] = true;
    } catch {
      /* frozen / non-extensible — fine, dedupe is best-effort too */
    }
  }
};

// ---------------- public API ----------------

export type NotifyTxParams = {
  chainId: number;
  chainName?: string;
  action: string;
  txHash: string;
  meta?: Record<string, unknown>;
  logger?: Logger;
};

/**
 * Post a "tx submitted" success notification. Hyperlinks the txHash to the right
 * block explorer. Best-effort — never throws.
 */
export const notifyTxSuccess = async (p: NotifyTxParams): Promise<void> => {
  if (
    !process.env.SLACK_WEBHOOK_URL &&
    !process.env.TELEGRAM_BOT_TOKEN &&
    !process.env.TELEGRAM_WEBHOOK_URL
  ) {
    return;
  }

  const chain = chainLabel(p.chainId, p.chainName);
  const url = txUrl(p.chainId, p.txHash);
  const short = shortHash(p.txHash);
  const meta = renderMeta(p.meta);

  // Slack: mrkdwn — `<URL|text>` for a link, backticks for inline code.
  const slackTxLine = url ? `tx: <${url}|${short}>` : `tx: \`${p.txHash}\``;
  const slack =
    `:white_check_mark: *${p.action}* on \`${chain}\`` +
    (meta.slack ? `\n${meta.slack}` : '') +
    `\n${slackTxLine}`;

  // Telegram HTML: <b>, <code>, <a href>.
  const tgTxLine = url
    ? `tx: <a href="${url}">${escapeHtml(short)}</a>`
    : `tx: <code>${escapeHtml(p.txHash)}</code>`;
  const tg =
    `✅ <b>${escapeHtml(p.action)}</b> on <code>${escapeHtml(chain)}</code>` +
    (meta.tg ? `\n${meta.tg}` : '') +
    `\n${tgTxLine}`;

  // Plain text fallback for the relay — still includes the explorer URL, just unlinked.
  const plain =
    `✅ ${p.action} on ${chain}` +
    (meta.plain ? `\n${meta.plain}` : '') +
    `\ntx: ${url ?? p.txHash}`;

  await fanOut(slack, tg, plain, p.logger);
};

export type NotifyErrorParams = {
  source: string;
  error: unknown;
  chainId?: number;
  chainName?: string;
  meta?: Record<string, unknown>;
  logger?: Logger;
};

/** Post a failure notification. Marks the error so an outer wrapper won't re-notify. */
export const notifyError = async (p: NotifyErrorParams): Promise<void> => {
  if (isAlreadyNotified(p.error)) return;
  markNotified(p.error);

  if (
    !process.env.SLACK_WEBHOOK_URL &&
    !process.env.TELEGRAM_BOT_TOKEN &&
    !process.env.TELEGRAM_WEBHOOK_URL
  ) {
    return;
  }

  const chainPart =
    p.chainId !== undefined ? ` (chain: \`${chainLabel(p.chainId, p.chainName)}\`)` : '';
  const chainPartTg =
    p.chainId !== undefined
      ? ` (chain: <code>${escapeHtml(chainLabel(p.chainId, p.chainName))}</code>)`
      : '';

  const errMessage = p.error instanceof Error ? p.error.message : String(p.error);
  const stackLines =
    p.error instanceof Error && p.error.stack
      ? p.error.stack.split('\n').slice(0, 5).join('\n')
      : '';

  const meta = renderMeta(p.meta);

  const slack =
    `:rotating_light: *${p.source}* failed${chainPart}` +
    (meta.slack ? `\n${meta.slack}` : '') +
    `\n\`\`\`${errMessage}${stackLines ? '\n' + stackLines : ''}\`\`\``;

  const tg =
    `🚨 <b>${escapeHtml(p.source)}</b> failed${chainPartTg}` +
    (meta.tg ? `\n${meta.tg}` : '') +
    `\n<pre>${escapeHtml(errMessage + (stackLines ? '\n' + stackLines : ''))}</pre>`;

  const plain =
    `🚨 ${p.source} failed` +
    (p.chainId !== undefined ? ` (chain: ${chainLabel(p.chainId, p.chainName)})` : '') +
    (meta.plain ? `\n${meta.plain}` : '') +
    `\n${errMessage}` +
    (stackLines ? `\n${stackLines}` : '');

  await fanOut(slack, tg, plain, p.logger);
};

export type NotifyHealthParams = {
  /** Slack mrkdwn-formatted message body. */
  slack: string;
  /** Telegram HTML-formatted message body. */
  tg: string;
  /** Plain-text fallback for the opaque Telegram relay. */
  plain: string;
  logger?: Logger;
};

/**
 * Post a pre-rendered health/balance alert to every configured channel. Caller decides
 * when to send (e.g. only when chains are below threshold) and renders the three flavors;
 * this function only owns the channel fan-out. Best-effort — never throws.
 */
export const notifyHealth = async (p: NotifyHealthParams): Promise<void> => {
  if (
    !process.env.SLACK_WEBHOOK_URL &&
    !process.env.TELEGRAM_BOT_TOKEN &&
    !process.env.TELEGRAM_WEBHOOK_URL
  ) {
    return;
  }
  await fanOut(p.slack, p.tg, p.plain, p.logger);
};

// Re-export so callers don't need a separate import for the explorer URL.
export {explorerBaseUrl, txUrl};
