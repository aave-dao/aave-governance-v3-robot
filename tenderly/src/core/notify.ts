import {createHash} from 'node:crypto';
import type {Hex, PublicClient} from 'viem';
import type {Logger} from './logger';
import {explorerBaseUrl, shortHash, txUrl} from './explorers';
import {redactSecrets} from './redact-secrets';

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

/**
 * Benign "the action wasn't applicable" failures: precondition `check()` returned
 * `{ok: false}` and the orchestration / execute-action layer turned that into a thrown
 * Error. Common causes:
 *   - operator clicked execute twice
 *   - the cron scan saw a payload as Queued, but another keeper executed it before us
 *   - state moved on between scan and execute (Cancelled, Expired, …)
 *
 * These are NOT system faults and shouldn't page anyone. They're recorded in the
 * `executions` table / cron summary either way.
 */
const isPreconditionFailure = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return /\bnot eligible:|\bprecheck failed:/.test(msg);
};

const markNotified = (err: unknown): void => {
  if (typeof err === 'object' && err !== null) {
    try {
      (err as {[k: symbol]: unknown})[NOTIFIED_AT] = true;
    } catch {
      /* frozen / non-extensible — fine, dedupe is best-effort too */
    }
  }
};

// ---------------- cross-process dedupe ----------------

/**
 * Pluggable persistent dedupe store. Without one installed, only the in-process symbol
 * marker dedupes — meaning the same persistent failure (e.g. an RPC outage on every cron
 * tick) re-notifies forever. With a store installed, the same fingerprint within
 * `DEDUPE_WINDOW_SEC` is suppressed.
 *
 * The interface installs a Postgres-backed store at boot; tenderly installs a Storage-backed
 * store from setupChain.
 */
export type DedupeStore = {
  /** Returns the unix-seconds timestamp of the last fired notification, or null. */
  getLastNotified(fingerprint: string): Promise<number | null>;
  /** Records that this fingerprint just fired (resets the window). */
  setLastNotified(
    fingerprint: string,
    atSec: number,
    info: {source: string; chainId?: number; message: string},
  ): Promise<void>;
  /** Optional: bump suppressed-count when a dedupe hit occurs. Best-effort. */
  bumpSuppressed?(fingerprint: string): Promise<void>;
};

let installedStore: DedupeStore | null = null;
/** Install (or replace) the persistent dedupe store. Pass null to disable. */
export const setNotifyDedupeStore = (store: DedupeStore | null): void => {
  installedStore = store;
};

/** Default window — re-alert on the same fingerprint only after this many seconds. */
export const DEDUPE_WINDOW_SEC = 6 * 60 * 60;

const stableStringify = (obj: Record<string, unknown> | undefined): string => {
  if (!obj) return '';
  const keys = Object.keys(obj).sort();
  return JSON.stringify(keys.map((k) => [k, obj[k]]));
};

/**
 * Strip per-invocation volatile values from a message before fingerprinting:
 *   • 0x-prefixed hex (8+ chars)  → <hex>   — tx hashes, addresses
 *   • bare large numbers (5+ digits) → <num> — block numbers, fees, timestamps
 *
 * Without this, alerts like `tx executePayload reverted on-chain: 0xabcd… (block 12345)`
 * would have a fresh fingerprint per retry (new txHash + new block) and never dedupe.
 */
const normalizeForFingerprint = (s: string): string =>
  s.replace(/0x[0-9a-fA-F]{8,}/g, '<hex>').replace(/\b\d{5,}\b/g, '<num>');

/**
 * Stable fingerprint of an alert, used as the dedupe key. Built from the source name,
 * chainId, sorted-meta, and the *normalized* first line of the redacted message. The
 * first line is the deterministic part of an error (the rest is stack/RPC noise that
 * varies between invocations); normalizing volatile hex/numbers lets us recognise "the
 * same error" even when downstream details shift.
 */
const fingerprintError = (
  source: string,
  chainId: number | undefined,
  meta: Record<string, unknown> | undefined,
  redactedMessage: string,
): string => {
  const firstLine = (redactedMessage.split('\n')[0] ?? '').slice(0, 500);
  const normalized = normalizeForFingerprint(firstLine);
  const raw = `${source}|${chainId ?? ''}|${stableStringify(meta)}|${normalized}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
};

// ---------------- proposal-context enrichment for notifyTxSuccess ---------------

/**
 * When the tx is associated with a proposal (`meta.proposalId` is set), enrich the
 * success notification with: IPFS title/author, public vote dashboard + operator
 * dashboard deep-links, and (for cross-chain-emitting actions) ADI envelope links.
 *
 * Returns line fragments in three flavors. Every step is independently try-catched —
 * a failed enrichment NEVER blocks the underlying notification, it just drops the
 * relevant line.
 */
type EnrichmentLines = {
  preMeta: {slack: string[]; tg: string[]; plain: string[]};
  postTx: {slack: string[]; tg: string[]; plain: string[]};
};

const EMPTY_ENRICHMENT: EnrichmentLines = {
  preMeta: {slack: [], tg: [], plain: []},
  postTx: {slack: [], tg: [], plain: []},
};

const enrichProposalContext = async (
  proposalId: string | undefined,
  chainId: number,
  receiptLogs: ReadonlyArray<{address: string; topics: readonly string[] | string[]}>,
  logger?: Logger,
): Promise<EnrichmentLines> => {
  if (!proposalId) return EMPTY_ENRICHMENT;

  const out: EnrichmentLines = {
    preMeta: {slack: [], tg: [], plain: []},
    postTx: {slack: [], tg: [], plain: []},
  };

  // 1. Title + author from L1 IPFS. Lazy imports to avoid circular module init issues.
  try {
    const [{getPublicClient}, {governanceAbi}, {fetchProposalMetadataSafe}, {GOVERNANCE_CHAIN_ID}] =
      await Promise.all([
        import('./clients'),
        import('./abis'),
        import('./ipfs'),
        import('./chains'),
      ]);
    const {GovernanceV3Ethereum} = await import('@aave-dao/aave-address-book');
    const l1 = getPublicClient(GOVERNANCE_CHAIN_ID);
    const proposal = (await l1.readContract({
      address: GovernanceV3Ethereum.GOVERNANCE as `0x${string}`,
      abi: governanceAbi,
      functionName: 'getProposal',
      args: [BigInt(proposalId)],
    })) as {ipfsHash: `0x${string}`};
    const ZERO = ('0x' + '00'.repeat(32)) as `0x${string}`;
    if (proposal.ipfsHash && proposal.ipfsHash !== ZERO) {
      const md = await fetchProposalMetadataSafe(proposal.ipfsHash);
      if (md?.title) {
        out.preMeta.slack.push(`title: ${md.title}`);
        out.preMeta.tg.push(`title: ${escapeHtml(md.title)}`);
        out.preMeta.plain.push(`title: ${md.title}`);
      }
      if (md?.author) {
        out.preMeta.slack.push(`author: ${md.author}`);
        out.preMeta.tg.push(`author: ${escapeHtml(md.author)}`);
        out.preMeta.plain.push(`author: ${md.author}`);
      }
    }
  } catch (err) {
    logger?.warn('notifyTxSuccess: ipfs enrichment failed', {
      proposalId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Dashboard deep-links — each try/catch independently so one failure doesn't drop
  //    the other.
  try {
    const {aaveVoteUrl} = await import('./links');
    const url = aaveVoteUrl(proposalId);
    out.postTx.slack.push(`<${url}|vote dashboard>`);
    out.postTx.tg.push(`<a href="${url}">vote dashboard</a>`);
    out.postTx.plain.push(url);
  } catch (err) {
    logger?.warn('notifyTxSuccess: vote-link build failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    const {operatorDashboardUrl} = await import('./links');
    const url = operatorDashboardUrl(proposalId);
    out.postTx.slack.push(`<${url}|operator dashboard>`);
    out.postTx.tg.push(`<a href="${url}">operator dashboard</a>`);
    out.postTx.plain.push(url);
  } catch (err) {
    logger?.warn('notifyTxSuccess: operator-link build failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. ADI envelope links — only present when the tx actually emitted `EnvelopeRegistered`
  //    logs. Source-chain CrossChainController address comes from the chainId we just
  //    confirmed the tx on.
  try {
    const {crossChainControllerFor, extractEnvelopeIds} = await import('./adi');
    const {adiEnvelopeUrl} = await import('./links');
    const envelopes = extractEnvelopeIds(receiptLogs, crossChainControllerFor(chainId));
    for (const id of envelopes) {
      const url = adiEnvelopeUrl(id);
      const short = `${id.slice(0, 8)}…${id.slice(-4)}`;
      out.postTx.slack.push(`envelope: <${url}|${short}>`);
      out.postTx.tg.push(`envelope: <a href="${url}">${escapeHtml(short)}</a>`);
      out.postTx.plain.push(`envelope: ${url}`);
    }
  } catch (err) {
    logger?.warn('notifyTxSuccess: envelope enrichment failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return out;
};

// ---------------- public API ----------------

export type NotifyTxParams = {
  /** Used to wait for the receipt before notifying. */
  publicClient: PublicClient;
  chainId: number;
  chainName?: string;
  action: string;
  txHash: string;
  meta?: Record<string, unknown>;
  logger?: Logger;
  /** Receipt-wait timeout in ms. Defaults to 90s (single Tenderly Action invocation budget). */
  confirmTimeoutMs?: number;
};

const DEFAULT_CONFIRM_TIMEOUT_MS = 90_000;

/**
 * Wait for the tx receipt, then post a "tx confirmed" success notification. Hyperlinks the
 * txHash to the right block explorer. Throws on revert or confirmation timeout — the outer
 * `notifyError` pipeline picks those up, so we never post a false-success alert when a tx
 * was accepted into the mempool but reverted on-chain.
 */
export const notifyTxSuccess = async (p: NotifyTxParams): Promise<void> => {
  // Wait for confirmation first. A successful broadcast (mempool acceptance) is not the
  // same as a successful execution — txs can revert post-broadcast (out-of-gas, runtime
  // require, race condition). Notifying only on a confirmed `success` receipt avoids
  // false positives in Slack/Telegram.
  let receipt: Awaited<ReturnType<PublicClient['waitForTransactionReceipt']>>;
  try {
    receipt = await p.publicClient.waitForTransactionReceipt({
      hash: p.txHash as Hex,
      timeout: p.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS,
    });
  } catch (err) {
    throw new Error(
      `tx ${p.action} submitted but confirmation failed: ${p.txHash} — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (receipt.status !== 'success') {
    throw new Error(
      `tx ${p.action} reverted on-chain: ${p.txHash} (block ${receipt.blockNumber.toString()})`,
    );
  }

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
  const meta = renderMeta({...p.meta, block: receipt.blockNumber.toString()});

  // Proposal-context enrichment: when meta.proposalId is set, fetch IPFS title/author,
  // build vote+operator dashboard deep-links, and parse ADI envelope IDs from receipt.logs.
  // Every step internally try-catched — a single failure drops only that line, never the
  // notification itself.
  const proposalId =
    typeof p.meta?.proposalId === 'string' || typeof p.meta?.proposalId === 'number'
      ? String(p.meta.proposalId)
      : undefined;
  const enrichment = await enrichProposalContext(
    proposalId,
    p.chainId,
    receipt.logs as ReadonlyArray<{address: string; topics: readonly string[] | string[]}>,
    p.logger,
  );

  const joinLines = (lines: string[]): string => (lines.length > 0 ? '\n' + lines.join('\n') : '');

  // Slack: mrkdwn — `<URL|text>` for a link, backticks for inline code.
  const slackTxLine = url ? `tx: <${url}|${short}>` : `tx: \`${p.txHash}\``;
  const slack =
    `:white_check_mark: *${p.action}* on \`${chain}\`` +
    joinLines(enrichment.preMeta.slack) +
    (meta.slack ? `\n${meta.slack}` : '') +
    `\n${slackTxLine}` +
    joinLines(enrichment.postTx.slack);

  // Telegram HTML: <b>, <code>, <a href>.
  const tgTxLine = url
    ? `tx: <a href="${url}">${escapeHtml(short)}</a>`
    : `tx: <code>${escapeHtml(p.txHash)}</code>`;
  const tg =
    `✅ <b>${escapeHtml(p.action)}</b> on <code>${escapeHtml(chain)}</code>` +
    joinLines(enrichment.preMeta.tg) +
    (meta.tg ? `\n${meta.tg}` : '') +
    `\n${tgTxLine}` +
    joinLines(enrichment.postTx.tg);

  // Plain text fallback for the relay — still includes the explorer URL, just unlinked.
  const plain =
    `✅ ${p.action} on ${chain}` +
    joinLines(enrichment.preMeta.plain) +
    (meta.plain ? `\n${meta.plain}` : '') +
    `\ntx: ${url ?? p.txHash}` +
    joinLines(enrichment.postTx.plain);

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

  // Benign "wrong state" / "precheck failed" errors aren't worth alerting — the action
  // simply wasn't applicable at the time it was attempted (race with another keeper, an
  // operator double-click, etc.). Silently drop. The execution row still records `failed`
  // for forensics.
  if (isPreconditionFailure(p.error)) {
    p.logger?.debug('notify: skipping precondition failure', {
      source: p.source,
      message: p.error instanceof Error ? p.error.message : String(p.error),
    });
    return;
  }

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

  // Redact RPC API keys / tokens before they hit Slack/Telegram. Viem RPC errors regularly
  // include the full provider URL, which would otherwise leak the key.
  const errMessage = redactSecrets(
    p.error instanceof Error ? p.error.message : String(p.error),
  );
  const stackLines = redactSecrets(
    p.error instanceof Error && p.error.stack
      ? p.error.stack.split('\n').slice(0, 5).join('\n')
      : '',
  );

  // Cross-process dedupe: if this fingerprint fired within the window, suppress and bail.
  // We do this AFTER computing the message (so the fingerprint reflects the redacted
  // first-line) but BEFORE rendering the channel-specific bodies (cheap savings on dedupe
  // hits, which are the common case for persistent failures).
  const fp = fingerprintError(p.source, p.chainId, p.meta, errMessage);
  if (installedStore) {
    try {
      const last = await installedStore.getLastNotified(fp);
      if (last !== null) {
        const ageSec = Math.floor(Date.now() / 1000) - last;
        if (ageSec < DEDUPE_WINDOW_SEC) {
          p.logger?.debug('notify: dedupe hit, suppressing alert', {
            source: p.source,
            fp,
            ageSec,
            windowSec: DEDUPE_WINDOW_SEC,
          });
          if (installedStore.bumpSuppressed) {
            try {
              await installedStore.bumpSuppressed(fp);
            } catch {
              /* best-effort */
            }
          }
          return;
        }
      }
    } catch (err) {
      // Never let a dedupe-store failure suppress an alert — fall through and notify.
      p.logger?.warn('notify: dedupe lookup failed (alerting anyway)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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

  // Record the fire so subsequent identical alerts within the window get suppressed.
  if (installedStore) {
    try {
      await installedStore.setLastNotified(fp, Math.floor(Date.now() / 1000), {
        source: p.source,
        chainId: p.chainId,
        message: errMessage,
      });
    } catch (err) {
      p.logger?.warn('notify: dedupe store update failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
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

/**
 * Generic "info" notification — caller renders the three flavours (Slack mrkdwn /
 * Telegram HTML / plain) and we just fan-out. Same shape as `notifyHealth` but named
 * for non-health success/event-style notifications (proposal lifecycle, etc.). Bypasses
 * the dedupe store on purpose — these are positive signals, not errors.
 */
export type NotifyInfoParams = NotifyHealthParams;
export const notifyInfo = async (p: NotifyInfoParams): Promise<void> => {
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
