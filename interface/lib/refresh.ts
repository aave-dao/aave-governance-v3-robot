import { GovernanceV3Ethereum } from '@aave-dao/aave-address-book';
import { eq } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import { governanceAbi } from '@robot/core/abis';
import { notifyError } from '@robot/core/notify';
import {
  inspectProposal,
  type ActionStatus,
  type InspectorReport,
} from '@robot/orchestration/proposalInspector';
import { proposalStateName } from '@robot/core/state';
import { db } from '@/db/client';
import {
  payloads,
  proposals,
  type EligibilityBlob,
  type EligibilityCheck,
  type NextRecommendedBlob,
  type ProposalMetadataBlob,
} from '@/db/schema';
import { buildInspectorClientsFromEnv } from './context-factory';
import { displayStateName } from './display-state';
import { indexLifecycleTxs } from './lifecycle-index';
import { jsonSafe } from './serialize';
import { syncVotesForProposal, type VotesSyncSummary } from './votes-sync';

const N_PROPOSALS = 20;
/** Per-tick cap for inspecting OLDER missing proposals (those outside the top-N window).
 *  Bounded so a fresh DB doesn't try to inspect 500 proposals in one cron run — at 10/tick
 *  every 5 min a fully-empty DB fills in ~4 hours. Once the table is fully populated this
 *  loop is a no-op. */
const BACKFILL_PER_TICK = 10;

const toCheck = (a: ActionStatus | undefined): EligibilityCheck => {
  if (!a) return { eligible: false, reason: 'no status' };
  if (a.status === 'ready') return { eligible: true };
  if (a.status === 'done') return { eligible: false, reason: a.reason, done: true };
  return { eligible: false, reason: a.reason, etaAt: a.etaAt };
};

const findAction = (actions: ActionStatus[] | undefined, name: string): ActionStatus | undefined =>
  actions?.find((a) => a.name === name);

const reportToEligibility = (rep: InspectorReport): EligibilityBlob => {
  const govActions = rep.governance.actions;
  const blob: EligibilityBlob = {
    activate: toCheck(findAction(govActions, 'activateVoting')),
    execute: toCheck(findAction(govActions, 'executeProposal')),
    cancel: toCheck(findAction(govActions, 'cancelProposal')),
    payloads: rep.payloads.map((p) => ({
      chainId: p.chainId,
      chainName: p.chainName,
      payloadId: p.payloadId,
      state: p.state,
      stateNumber: p.stateNumber,
      executable: toCheck(findAction(p.actions, 'executePayload')),
    })),
  };
  if (rep.voting) {
    blob.voting = {
      chainId: rep.voting.chainId,
      chainName: rep.voting.chain,
      state: rep.voting.state,
      stateNumber: rep.voting.stateNumber,
      submitStorageRoots: toCheck(findAction(rep.voting.actions, 'submitStorageRoots')),
      createVote: toCheck(findAction(rep.voting.actions, 'createVote')),
      closeAndSendVote: toCheck(findAction(rep.voting.actions, 'closeAndSendVote')),
    };
  }
  return blob;
};

const reportToNextRecommended = (rep: InspectorReport): NextRecommendedBlob | null => {
  if (!rep.nextRecommended) return null;
  return {
    stage: rep.nextRecommended.stage,
    action: rep.nextRecommended.action,
    chainId: rep.nextRecommended.chainId,
    id: rep.nextRecommended.id.toString(),
  };
};

const reportToMetadata = (rep: InspectorReport): ProposalMetadataBlob | null => {
  if (!rep.metadata) return null;
  return {
    title: rep.metadata.title,
    author: rep.metadata.author,
    discussions: rep.metadata.discussions,
    shortDescription: rep.metadata.shortDescription,
    body: rep.metadata.body,
    raw: rep.metadata.raw,
  };
};

type InspectorBundle = ReturnType<typeof buildInspectorClientsFromEnv>;

const upsertReport = async (
  bundle: InspectorBundle,
  id: bigint,
  rep: InspectorReport,
): Promise<{ votes: VotesSyncSummary | null }> => {
  const eligibility = reportToEligibility(rep);
  const metadata = reportToMetadata(rep);
  const nextRecommended = reportToNextRecommended(rep);

  const proposalRow = {
    id,
    state: rep.governance.stateNumber,
    stateName: rep.governance.state,
    displayState: displayStateName(
      rep.governance.stateNumber,
      rep.governance.state,
      eligibility.payloads,
    ),
    creator: rep.governance.creator,
    creationTime: rep.governance.creationTime,
    votingActivationTime: rep.governance.votingActivationTime,
    queuingTime: rep.governance.queuingTime,
    votingDuration: rep.governance.votingDuration,
    cooldownPeriod: rep.governance.cooldownPeriod,
    coolDownBeforeVotingStart: rep.governance.coolDownBeforeVotingStart,
    accessLevel: 0,
    snapshotBlockHash: rep.governance.snapshotBlockHash,
    ipfsHash: rep.governance.ipfsHash,
    votingPortal: rep.governance.votingPortal,
    // L1 final tally is meaningful only after queueProposal runs.
    forVotes:
      rep.governance.stateNumber >= 3 ? rep.governance.forVotes.toString() : null,
    againstVotes:
      rep.governance.stateNumber >= 3 ? rep.governance.againstVotes.toString() : null,
    vmForVotes: rep.voting ? rep.voting.forVotes.toString() : null,
    vmAgainstVotes: rep.voting ? rep.voting.againstVotes.toString() : null,
    vmStateName: rep.voting ? rep.voting.state : null,
    yesThreshold: rep.governance.yesThreshold.toString(),
    yesNoDifferential: rep.governance.yesNoDifferential.toString(),
    metadata,
    metadataError: rep.metadataError ?? null,
    eligibility,
    nextRecommended,
    raw: jsonSafe({
      governance: rep.governance,
      voting: rep.voting,
      payloads: rep.payloads,
    }) as object,
    refreshedAt: new Date(),
    updatedAt: new Date(),
  };

  await db
    .insert(proposals)
    .values(proposalRow)
    .onConflictDoUpdate({
      target: proposals.id,
      set: {
        state: proposalRow.state,
        stateName: proposalRow.stateName,
        displayState: proposalRow.displayState,
        creator: proposalRow.creator,
        creationTime: proposalRow.creationTime,
        votingActivationTime: proposalRow.votingActivationTime,
        queuingTime: proposalRow.queuingTime,
        votingDuration: proposalRow.votingDuration,
        cooldownPeriod: proposalRow.cooldownPeriod,
        coolDownBeforeVotingStart: proposalRow.coolDownBeforeVotingStart,
        accessLevel: proposalRow.accessLevel,
        snapshotBlockHash: proposalRow.snapshotBlockHash,
        ipfsHash: proposalRow.ipfsHash,
        votingPortal: proposalRow.votingPortal,
        forVotes: proposalRow.forVotes,
        againstVotes: proposalRow.againstVotes,
        vmForVotes: proposalRow.vmForVotes,
        vmAgainstVotes: proposalRow.vmAgainstVotes,
        vmStateName: proposalRow.vmStateName,
        yesThreshold: proposalRow.yesThreshold,
        yesNoDifferential: proposalRow.yesNoDifferential,
        metadata: proposalRow.metadata,
        metadataError: proposalRow.metadataError,
        eligibility: proposalRow.eligibility,
        nextRecommended: proposalRow.nextRecommended,
        raw: proposalRow.raw,
        refreshedAt: proposalRow.refreshedAt,
        updatedAt: proposalRow.updatedAt,
        // Successful refresh clears any previous failure state for this proposal.
        lastError: null,
        lastErrorAt: null,
      },
    });

  for (const p of rep.payloads) {
    const executable = toCheck(findAction(p.actions, 'executePayload'));
    const rawBlob = jsonSafe({
      createdAt: p.createdAt ?? null,
      queuedAt: p.queuedAt ?? null,
      executedAt: p.executedAt ?? null,
      cancelledAt: p.cancelledAt ?? null,
      expirationTime: p.expirationTime ?? null,
      delay: p.delay ?? null,
      gracePeriod: p.gracePeriod ?? null,
      executionActions: p.executionActions ?? [],
    }) as object;
    const row = {
      chainId: p.chainId,
      payloadId: p.payloadId,
      proposalId: id,
      chainName: p.chainName,
      payloadsController: p.payloadsController,
      state: p.stateNumber,
      stateName: p.state,
      actionCount: p.actionCount,
      queuedAt: p.queuedAt && p.queuedAt > 0 ? p.queuedAt : null,
      delay: p.delay ?? null,
      executable,
      raw: rawBlob,
      refreshedAt: new Date(),
    };
    await db
      .insert(payloads)
      .values(row)
      .onConflictDoUpdate({
        target: [payloads.chainId, payloads.payloadId, payloads.proposalId],
        set: {
          proposalId: row.proposalId,
          chainName: row.chainName,
          payloadsController: row.payloadsController,
          state: row.state,
          stateName: row.stateName,
          actionCount: row.actionCount,
          queuedAt: row.queuedAt,
          delay: row.delay,
          executable: row.executable,
          raw: row.raw,
          refreshedAt: row.refreshedAt,
        },
      });
  }

  // Index any lifecycle event tx hashes that should exist by now and aren't yet cached.
  // Best effort — RPC failures are logged inside and retried next tick.
  try {
    await indexLifecycleTxs({
      proposalId: id,
      proposalState: rep.governance.stateNumber,
      vmStateName: rep.voting?.state ?? null,
      creationTime: rep.governance.creationTime,
      votingPortal: (rep.governance.votingPortal as `0x${string}`) ?? null,
      snapshotBlockHash: (rep.governance.snapshotBlockHash as Hex) ?? null,
      payloads: rep.payloads.map((p) => ({
        chainId: p.chainId,
        payloadId: p.payloadId,
        stateNumber: p.stateNumber,
        queuedAt: p.queuedAt ?? null,
        executedAt: p.executedAt ?? null,
      })),
    });
  } catch (err) {
    bundle.logger.warn('refresh: lifecycle index failed', {
      proposalId: id.toString(),
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Sync VoteEmitted events on the voting chain — best effort, never fails the upsert.
  let votesSummary: VotesSyncSummary | null = null;
  if (rep.voting) {
    const vmClient = bundle.votingClients[rep.voting.chainId];
    if (vmClient) {
      try {
        votesSummary = await syncVotesForProposal({
          proposalId: id,
          votingChainId: rep.voting.chainId,
          vmClient,
          logger: bundle.logger,
        });
      } catch (err) {
        bundle.logger.warn('refresh: votes sync failed', {
          proposalId: id.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { votes: votesSummary };
};

export type RefreshSummary = {
  totalProposals: number;
  inspected: number;
  upserted: number;
  errors: Array<{ proposalId: string; error: string }>;
};

/**
 * Record a per-proposal inspector failure. Sets `last_error` + `last_error_at` WITHOUT
 * touching `refreshed_at` or any other field, so the row's last-successful-refresh
 * timestamp is preserved (the UI uses that to detect staleness). Also fires a Slack/Telegram
 * alert — the notify layer's existing 6h fingerprint dedupe ([@robot/core/notify]) prevents
 * tick-by-tick spam for a persistently-failing proposal.
 *
 * Defensive: if the proposal row doesn't exist yet (e.g. failure happened during the very
 * first inspection attempt), the UPDATE is a no-op rather than creating a half-row. The
 * cron will eventually re-inspect on a future tick.
 */
const recordProposalError = async (
  id: bigint,
  reason: unknown,
  logger: import('@robot/core/logger').Logger,
): Promise<void> => {
  const message = reason instanceof Error ? reason.message : String(reason);
  try {
    await db
      .update(proposals)
      .set({
        // Truncate so a megabyte stack trace doesn't bloat the row.
        lastError: message.slice(0, 4_000),
        lastErrorAt: new Date(),
      })
      .where(eq(proposals.id, id));
  } catch (dbErr) {
    logger.warn('refresh: failed to record per-proposal error', {
      proposalId: id.toString(),
      error: dbErr instanceof Error ? dbErr.message : String(dbErr),
    });
  }
  try {
    await notifyError({
      source: 'inspectProposal',
      error: reason,
      meta: { proposalId: id.toString() },
      logger,
    });
  } catch {
    /* notifyError itself is best-effort and never throws — defensive catch anyway */
  }
};

export const inspectAndCacheProposal = async (id: bigint): Promise<InspectorReport> => {
  const bundle = buildInspectorClientsFromEnv();
  try {
    const rep = await inspectProposal(
      {
        l1Public: bundle.govPublic,
        votingClients: bundle.votingClients,
        executionClients: bundle.executionClients,
        logger: bundle.logger,
      },
      id,
    );
    await upsertReport(bundle, id, rep);
    return rep;
  } catch (err) {
    // Mirror the cron's per-proposal error handling so on-visit self-heal AND the manual
    // refresh button both populate last_error / fire the alert. Then re-throw so callers
    // can react (e.g. show an error message to the user).
    await recordProposalError(id, err, bundle.logger);
    throw err;
  }
};

export const runCacheRefresh = async (): Promise<RefreshSummary> => {
  const bundle = buildInspectorClientsFromEnv();

  const total = await bundle.govPublic.readContract({
    address: GovernanceV3Ethereum.GOVERNANCE as Address,
    abi: governanceAbi,
    functionName: 'getProposalsCount',
  });
  if (total === 0n) {
    return { totalProposals: 0, inspected: 0, upserted: 0, errors: [] };
  }

  const ids: bigint[] = [];
  for (let n = 0; n < N_PROPOSALS && BigInt(n) < total; n++) {
    ids.push(total - 1n - BigInt(n));
  }

  const settled = await Promise.allSettled(
    ids.map((id) =>
      inspectProposal(
        {
          l1Public: bundle.govPublic,
          votingClients: bundle.votingClients,
          executionClients: bundle.executionClients,
          logger: bundle.logger,
        },
        id,
      ),
    ),
  );

  const errors: Array<{ proposalId: string; error: string }> = [];
  let upserted = 0;

  for (const [i, result] of settled.entries()) {
    const id = ids[i]!;
    if (result.status === 'rejected') {
      const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push({ proposalId: id.toString(), error: err });
      await recordProposalError(id, result.reason, bundle.logger);
      continue;
    }
    try {
      await upsertReport(bundle, id, result.value);
      upserted += 1;
    } catch (err) {
      errors.push({
        proposalId: id.toString(),
        error: err instanceof Error ? err.message : String(err),
      });
      await recordProposalError(id, err, bundle.logger);
    }
  }

  // Backfill: pick up to BACKFILL_PER_TICK older proposals NOT YET in the DB and inspect
  // them. Walks newest-first below the top-N window so the list view fills in from the
  // top down. Once every id is cached this becomes a single cheap SELECT + no work.
  let backfilled = 0;
  if (total > BigInt(N_PROPOSALS)) {
    const existingRows = await db.select({ id: proposals.id }).from(proposals);
    const existing = new Set(existingRows.map((r) => r.id.toString()));
    const missing: bigint[] = [];
    const windowEnd = total - 1n - BigInt(N_PROPOSALS);
    for (let id = windowEnd; id >= 0n && missing.length < BACKFILL_PER_TICK; id--) {
      if (!existing.has(id.toString())) missing.push(id);
    }
    if (missing.length > 0) {
      bundle.logger.info('refresh: backfilling missing proposals', {
        count: missing.length,
        oldest: missing[missing.length - 1]!.toString(),
        newest: missing[0]!.toString(),
      });
      const backfillSettled = await Promise.allSettled(
        missing.map((id) =>
          inspectProposal(
            {
              l1Public: bundle.govPublic,
              votingClients: bundle.votingClients,
              executionClients: bundle.executionClients,
              logger: bundle.logger,
            },
            id,
          ),
        ),
      );
      for (const [i, result] of backfillSettled.entries()) {
        const id = missing[i]!;
        if (result.status === 'rejected') {
          const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
          errors.push({ proposalId: id.toString(), error: err });
          // No row to update yet (these are MISSING from the DB), so recordProposalError
          // would be a no-op on the UPDATE side. We still want the alert though.
          try {
            await notifyError({
              source: 'inspectProposal',
              error: result.reason,
              meta: { proposalId: id.toString(), phase: 'backfill' },
              logger: bundle.logger,
            });
          } catch {
            /* best-effort */
          }
          continue;
        }
        try {
          await upsertReport(bundle, id, result.value);
          backfilled += 1;
        } catch (err) {
          errors.push({
            proposalId: id.toString(),
            error: err instanceof Error ? err.message : String(err),
          });
          // upsertReport succeeded once enough to insert the row (or failed mid-upsert) —
          // either way, recordProposalError can run as an UPDATE.
          await recordProposalError(id, err, bundle.logger);
        }
      }
    }
  }

  return {
    totalProposals: Number(total),
    inspected: ids.length + backfilled,
    upserted: upserted + backfilled,
    errors,
  };
};

export { proposalStateName };
