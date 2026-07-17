// Best-effort IPFS backup triggered on `ProposalCreated`: as soon as a proposal appears we
// back its document up to every CONFIGURED provider (Pinata, Filebase) preserving the on-chain
// CIDv0, then post a one-line summary with gateway hyperlinks. Everything here is wrapped so a
// failure never affects the lifecycle listener that calls it.

import type {Hex} from 'viem';
import {ipfsHashToCidV0} from './ipfs';
import {migrateGroup, type MigrationItem, type ProposalCidGroup} from './ipfsMigration';
import type {Logger} from './logger';
import {notifyInfo} from './notify';
import {createFilebaseClient, resolveFilebaseConfig} from './filebase';
import {createPinataClient, normalizeGatewayHost, resolvePinataConfig} from './pinata';
import {makeFilebaseProvider, makePinataProvider, type BackupProvider} from './providers';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Filebase's shared public IPFS gateway — always available, no per-account config needed. */
export const filebaseGatewayUrl = (cid: string): string => `https://ipfs.filebase.io/ipfs/${cid}`;

/** Dedicated Pinata gateway if configured, else Pinata's public gateway. */
export const pinataGatewayUrl = (cid: string, env: NodeJS.ProcessEnv = process.env): string => {
  const gw = env.PINATA_GATEWAY?.trim();
  return gw
    ? `https://${normalizeGatewayHost(gw)}/ipfs/${cid}`
    : `https://gateway.pinata.cloud/ipfs/${cid}`;
};

const gatewayUrlFor = (provider: string, cid: string): string =>
  provider === 'filebase' ? filebaseGatewayUrl(cid) : pinataGatewayUrl(cid);

export type ProviderBackupResult = {
  provider: string;
  status: MigrationItem['status'];
  gatewayUrl: string;
  reason?: string;
};

/**
 * Build the providers that are actually configured in the environment. A provider whose
 * credentials are absent is silently skipped (returns fewer providers), never an error.
 */
export const buildConfiguredProviders = (logger: Logger): BackupProvider[] => {
  const providers: BackupProvider[] = [];
  try {
    const pinata = createPinataClient(resolvePinataConfig());
    providers.push(
      makePinataProvider(pinata, {
        // Gateway may be down / unset; verify against the account file list instead. Keep the
        // pin wait short so we don't hold the Tenderly Action open — unconfirmed → 'pending'.
        verifyViaGateway: false,
        allowReupload: false,
        pinTimeoutMs: 20_000,
        pollIntervalMs: 4_000,
        logger,
      }),
    );
  } catch (e) {
    logger.debug('proposal-backup: Pinata not configured', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  try {
    const filebase = createFilebaseClient(resolveFilebaseConfig());
    providers.push(makeFilebaseProvider(filebase, {logger}));
  } catch (e) {
    logger.debug('proposal-backup: Filebase not configured', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return providers;
};

/** Back up one CID to each provider (sequentially). Never throws. */
export const backupToProviders = async (
  providers: BackupProvider[],
  group: ProposalCidGroup,
  logger: Logger,
): Promise<ProviderBackupResult[]> => {
  const results: ProviderBackupResult[] = [];
  for (const provider of providers) {
    try {
      const item = await migrateGroup(provider, group, {dryRun: false, logger});
      results.push({
        provider: provider.name,
        status: item.status,
        gatewayUrl: gatewayUrlFor(provider.name, group.cid),
        reason: item.reason,
      });
    } catch (e) {
      // migrateGroup is designed not to throw, but never let a provider blip escape.
      results.push({
        provider: provider.name,
        status: 'failed',
        gatewayUrl: gatewayUrlFor(provider.name, group.cid),
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
};

const STATUS_VERB: Record<MigrationItem['status'], string> = {
  pinned: 'pinned on',
  'already-pinned': 'already on',
  pending: 'queued on',
  failed: 'failed on',
  'dry-run': 'would back up on',
};

const titleCase = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/** Render the one-line summary (Slack mrkdwn / Telegram HTML / plain) with gateway links. */
export const renderBackupSummary = (
  proposalId: bigint,
  cid: string,
  results: ProviderBackupResult[],
): {slack: string; tg: string; plain: string} => {
  const label = titleCase;
  const slackParts = results.map((r) => {
    const verb = STATUS_VERB[r.status];
    // Link the provider name to its gateway (except hard failures, where it won't resolve).
    return r.status === 'failed'
      ? `${verb} ${label(r.provider)}${r.reason ? ` (${r.reason})` : ''}`
      : `${verb} <${r.gatewayUrl}|${label(r.provider)}>`;
  });
  const tgParts = results.map((r) => {
    const verb = STATUS_VERB[r.status];
    return r.status === 'failed'
      ? `${verb} ${escapeHtml(label(r.provider))}${r.reason ? ` (${escapeHtml(r.reason)})` : ''}`
      : `${verb} <a href="${r.gatewayUrl}">${escapeHtml(label(r.provider))}</a>`;
  });
  const plainParts = results.map((r) => {
    const verb = STATUS_VERB[r.status];
    return r.status === 'failed'
      ? `${verb} ${label(r.provider)}${r.reason ? ` (${r.reason})` : ''}`
      : `${verb} ${label(r.provider)}: ${r.gatewayUrl}`;
  });

  const head = `📦 IPFS backup · proposal #${proposalId} · \`${cid}\``;
  return {
    slack: `${head}\n${slackParts.join(', ')}`,
    tg: `📦 <b>IPFS backup</b> · proposal #${proposalId} · <code>${escapeHtml(cid)}</code>\n${tgParts.join(', ')}`,
    plain: `IPFS backup · proposal #${proposalId} · ${cid}\n${plainParts.map((p) => `  ${p}`).join('\n')}`,
  };
};

export type BackupProposalInput = {
  proposalId: bigint;
  ipfsHash: Hex;
  logger: Logger;
};

const ZERO_HASH = ('0x' + '00'.repeat(32)) as Hex;

/**
 * Entry point for the ProposalCreated listener. Backs the proposal doc up to every configured
 * provider and posts a summary with gateway links. Fully best-effort: any failure is logged and
 * swallowed so the caller is never affected. Returns the per-provider results (or null when
 * skipped: no ipfsHash, or no providers configured).
 */
export const backupProposalOnCreated = async (
  input: BackupProposalInput,
): Promise<ProviderBackupResult[] | null> => {
  const {proposalId, ipfsHash, logger} = input;
  try {
    if (!ipfsHash || ipfsHash === ZERO_HASH) {
      logger.debug('proposal-backup: no ipfsHash on proposal, skipping', {
        proposalId: proposalId.toString(),
      });
      return null;
    }
    const providers = buildConfiguredProviders(logger);
    if (providers.length === 0) {
      logger.info('proposal-backup: no providers configured, skipping');
      return null;
    }

    const cid = ipfsHashToCidV0(ipfsHash);
    const group: ProposalCidGroup = {cid, ipfsHash, proposalIds: [proposalId]};
    const results = await backupToProviders(providers, group, logger);

    const summary = renderBackupSummary(proposalId, cid, results);
    try {
      await notifyInfo({...summary, logger});
    } catch (e) {
      logger.warn('proposal-backup: summary notify failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    logger.info('proposal-backup: done', {
      proposalId: proposalId.toString(),
      cid,
      results: results.map((r) => `${r.provider}:${r.status}`).join(','),
    });
    return results;
  } catch (e) {
    // Absolute backstop — this must never affect the lifecycle listener.
    logger.warn('proposal-backup: unexpected failure (ignored)', {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
};
