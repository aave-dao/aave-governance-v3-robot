// High-level "send a proposal lifecycle notification" entry point. Single function used
// by every event listener. Always fires the underlying notification — IPFS / dashboard /
// envelope enrichment is best-effort and never blocks the message.
//
// Enrichment layers (each independently try-catched so a failure in one drops only that
// line, never the message itself):
//   1. Title + author     — fetched via L1 `getProposal` → ipfsHash → fetchProposalMetadataSafe
//   2. Dashboard links    — `vote.onaave.com` + this repo's operator dashboard
//   3. Envelope links     — adi.onaave.com for cross-chain hops (executeProposal /
//                           closeAndSendVote). Caller passes the already-extracted IDs.

import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import type {Address, Hex, PublicClient} from 'viem';
import {governanceAbi} from './abis';
import {shortHash, txUrl} from './explorers';
import {fetchProposalMetadataSafe} from './ipfs';
import {aaveVoteUrl, adiEnvelopeUrl, operatorDashboardUrl} from './links';
import type {LifecycleEventName} from './lifecycle-events';
import type {Logger} from './logger';
import {notifyInfo} from './notify';

export type ProposalEventInput = {
  proposalId: bigint;
  event: LifecycleEventName;
  /** Chain where the event fired (for explorer link + display label). */
  chainId: number;
  chainName: string;
  /** Tx that emitted the event. */
  txHash: Hex;
  /** L1 public client — used to look up ipfsHash + creator from `getProposal`. */
  l1Client: PublicClient;
  /** Pre-extracted ADI envelope IDs (caller knows the source-chain CrossChainController). */
  envelopeIds?: Hex[];
  /** Free-form extra fields rendered inline (e.g. {forVotes: '...', againstVotes: '...'}). */
  extraFields?: Record<string, string>;
  logger?: Logger;
  /** If true, returns the rendered bodies without posting (used by the CLI test command). */
  dryRun?: boolean;
};

export type RenderedNotification = {
  slack: string;
  tg: string;
  plain: string;
};

// ─── Per-event human-readable label + emoji ────────────────────────────────────

const EVENT_LABEL: Record<LifecycleEventName, {emoji: string; title: string}> = {
  ProposalCreated: {emoji: '🆕', title: 'Proposal created'},
  VotingActivated: {emoji: '🗳️', title: 'Voting activated'},
  ProposalQueued: {emoji: '⏳', title: 'Proposal queued (L1)'},
  ProposalExecuted: {emoji: '🚀', title: 'Proposal executed (L1)'},
  ProposalCanceled: {emoji: '🛑', title: 'Proposal canceled'},
  ProposalVoteConfigurationBridged: {
    emoji: '🌉',
    title: 'Vote config bridged → voting chain',
  },
  ProposalVoteStarted: {emoji: '▶️', title: 'Vote started on L2'},
  ProposalResultsSent: {emoji: '📤', title: 'Vote closed · results sent to L1'},
};

// ─── HTML escape (reuse the same trick `notify.ts` uses; small enough to inline) ────

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ─── Enrichment fns (each independently try-catched at call site) ────────────────

const fetchTitleAndAuthor = async (
  proposalId: bigint,
  l1Client: PublicClient,
): Promise<{title?: string; author?: string}> => {
  const proposal = await l1Client.readContract({
    address: GovernanceV3Ethereum.GOVERNANCE as Address,
    abi: governanceAbi,
    functionName: 'getProposal',
    args: [proposalId],
  });
  const ipfsHash = proposal.ipfsHash as Hex;
  if (!ipfsHash || ipfsHash === ('0x' + '00'.repeat(32))) return {};
  const md = await fetchProposalMetadataSafe(ipfsHash);
  return {title: md?.title, author: md?.author};
};

// ─── Main entry point ─────────────────────────────────────────────────────────

export const notifyProposalEvent = async (
  p: ProposalEventInput,
): Promise<RenderedNotification> => {
  const {emoji, title: eventTitle} = EVENT_LABEL[p.event];

  // 1. Title + author — try/catch. Failure just drops the lines.
  let proposalTitle: string | undefined;
  let author: string | undefined;
  try {
    const md = await fetchTitleAndAuthor(p.proposalId, p.l1Client);
    proposalTitle = md.title;
    author = md.author;
  } catch (err) {
    p.logger?.warn('notifyProposalEvent: ipfs enrichment failed', {
      proposalId: p.proposalId.toString(),
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Dashboard links — try/catch each, so one failure doesn't drop the other.
  let voteLink: string | undefined;
  let dashboardLink: string | undefined;
  try {
    voteLink = aaveVoteUrl(p.proposalId);
  } catch (err) {
    p.logger?.warn('notifyProposalEvent: vote-link build failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    dashboardLink = operatorDashboardUrl(p.proposalId);
  } catch (err) {
    p.logger?.warn('notifyProposalEvent: operator-link build failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Envelope links — try/catch the map call.
  let envelopeLinks: Array<{id: Hex; url: string}> = [];
  if (p.envelopeIds && p.envelopeIds.length > 0) {
    try {
      envelopeLinks = p.envelopeIds.map((id) => ({id, url: adiEnvelopeUrl(id)}));
    } catch (err) {
      p.logger?.warn('notifyProposalEvent: envelope-link build failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const explorer = txUrl(p.chainId, p.txHash);
  const shortTx = shortHash(p.txHash);

  // Slack mrkdwn: <url|text> for links, *bold* for emphasis, `mono` for code.
  const slackLines: string[] = [];
  slackLines.push(`${emoji} *${eventTitle}* · proposal *#${p.proposalId}*`);
  if (proposalTitle) slackLines.push(`title: ${proposalTitle}`);
  if (author) slackLines.push(`author: ${author}`);
  slackLines.push(`chain: \`${p.chainName}\``);
  if (p.extraFields) {
    for (const [k, v] of Object.entries(p.extraFields)) {
      slackLines.push(`${k}: \`${v}\``);
    }
  }
  slackLines.push(explorer ? `tx: <${explorer}|${shortTx}>` : `tx: \`${p.txHash}\``);
  if (voteLink) slackLines.push(`<${voteLink}|vote dashboard>`);
  if (dashboardLink) slackLines.push(`<${dashboardLink}|operator dashboard>`);
  for (const e of envelopeLinks) {
    slackLines.push(`envelope: <${e.url}|${shortHash(e.id)}>`);
  }

  // Telegram HTML.
  const tgLines: string[] = [];
  tgLines.push(`${emoji} <b>${escapeHtml(eventTitle)}</b> · proposal <b>#${p.proposalId}</b>`);
  if (proposalTitle) tgLines.push(`title: ${escapeHtml(proposalTitle)}`);
  if (author) tgLines.push(`author: ${escapeHtml(author)}`);
  tgLines.push(`chain: <code>${escapeHtml(p.chainName)}</code>`);
  if (p.extraFields) {
    for (const [k, v] of Object.entries(p.extraFields)) {
      tgLines.push(`${escapeHtml(k)}: <code>${escapeHtml(v)}</code>`);
    }
  }
  tgLines.push(
    explorer
      ? `tx: <a href="${explorer}">${escapeHtml(shortTx)}</a>`
      : `tx: <code>${escapeHtml(p.txHash)}</code>`,
  );
  if (voteLink) tgLines.push(`<a href="${voteLink}">vote dashboard</a>`);
  if (dashboardLink) tgLines.push(`<a href="${dashboardLink}">operator dashboard</a>`);
  for (const e of envelopeLinks) {
    tgLines.push(`envelope: <a href="${e.url}">${escapeHtml(shortHash(e.id))}</a>`);
  }

  // Plain (Telegram opaque-relay fallback). Same content, no markup.
  const plainLines: string[] = [];
  plainLines.push(`${emoji} ${eventTitle} · proposal #${p.proposalId}`);
  if (proposalTitle) plainLines.push(`title: ${proposalTitle}`);
  if (author) plainLines.push(`author: ${author}`);
  plainLines.push(`chain: ${p.chainName}`);
  if (p.extraFields) {
    for (const [k, v] of Object.entries(p.extraFields)) {
      plainLines.push(`${k}: ${v}`);
    }
  }
  plainLines.push(`tx: ${explorer ?? p.txHash}`);
  if (voteLink) plainLines.push(voteLink);
  if (dashboardLink) plainLines.push(dashboardLink);
  for (const e of envelopeLinks) {
    plainLines.push(`envelope: ${e.url}`);
  }

  const rendered: RenderedNotification = {
    slack: slackLines.join('\n'),
    tg: tgLines.join('\n'),
    plain: plainLines.join('\n'),
  };

  if (p.dryRun) return rendered;

  try {
    await notifyInfo({...rendered, logger: p.logger});
  } catch (err) {
    // notifyInfo itself shouldn't throw (the underlying channel posts swallow their own
    // errors), but defensively: never let a notification failure escape and break the
    // listener that's iterating multiple logs.
    p.logger?.warn('notifyProposalEvent: notifyInfo threw unexpectedly', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return rendered;
};
