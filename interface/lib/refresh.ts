import 'server-only';
import { GovernanceV3Ethereum } from '@aave-dao/aave-address-book';
import { eq } from 'drizzle-orm';
import type { Address } from 'viem';
import { governanceAbi } from '@robot/core/abis';
import { inspectProposal, type ActionStatus, type InspectorReport } from '@robot/orchestration/proposalInspector';
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
import { jsonSafe } from './serialize';

const N_PROPOSALS = 20;

const toCheck = (a: ActionStatus | undefined): EligibilityCheck => {
  if (!a) return { eligible: false, reason: 'no status' };
  if (a.status === 'ready') return { eligible: true };
  if (a.status === 'done') return { eligible: false, reason: a.reason };
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

type RefreshSummary = {
  totalProposals: number;
  inspected: number;
  upserted: number;
  errors: Array<{ proposalId: string; error: string }>;
};

export const runCacheRefresh = async (): Promise<RefreshSummary> => {
  const { govPublic, votingClients, executionClients, logger } = buildInspectorClientsFromEnv();

  const total = await govPublic.readContract({
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
      inspectProposal({ l1Public: govPublic, votingClients, executionClients, logger }, id),
    ),
  );

  const errors: Array<{ proposalId: string; error: string }> = [];
  let upserted = 0;

  for (const [i, result] of settled.entries()) {
    const id = ids[i]!;
    if (result.status === 'rejected') {
      const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push({ proposalId: id.toString(), error: err });
      continue;
    }
    const rep = result.value;
    const eligibility = reportToEligibility(rep);
    const metadata = reportToMetadata(rep);
    const nextRecommended = reportToNextRecommended(rep);

    const proposalRow = {
      id,
      state: rep.governance.stateNumber,
      stateName: rep.governance.state,
      creator: rep.governance.creator,
      creationTime: rep.governance.creationTime,
      votingActivationTime: rep.governance.votingActivationTime,
      queuingTime: rep.governance.queuingTime,
      accessLevel: 0,
      snapshotBlockHash: rep.governance.snapshotBlockHash,
      ipfsHash: rep.governance.ipfsHash,
      votingPortal: rep.governance.votingPortal,
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
          creator: proposalRow.creator,
          creationTime: proposalRow.creationTime,
          votingActivationTime: proposalRow.votingActivationTime,
          queuingTime: proposalRow.queuingTime,
          accessLevel: proposalRow.accessLevel,
          snapshotBlockHash: proposalRow.snapshotBlockHash,
          ipfsHash: proposalRow.ipfsHash,
          votingPortal: proposalRow.votingPortal,
          metadata: proposalRow.metadata,
          metadataError: proposalRow.metadataError,
          eligibility: proposalRow.eligibility,
          nextRecommended: proposalRow.nextRecommended,
          raw: proposalRow.raw,
          refreshedAt: proposalRow.refreshedAt,
          updatedAt: proposalRow.updatedAt,
        },
      });

    for (const p of rep.payloads) {
      const executable = toCheck(findAction(p.actions, 'executePayload'));
      const row = {
        chainId: p.chainId,
        payloadId: p.payloadId,
        proposalId: id,
        chainName: p.chainName,
        payloadsController: p.payloadsController,
        state: p.stateNumber,
        stateName: p.state,
        actionCount: p.actionCount,
        queuedAt: null as number | null,
        delay: null as number | null,
        executable,
        raw: null,
        refreshedAt: new Date(),
      };
      await db
        .insert(payloads)
        .values(row)
        .onConflictDoUpdate({
          target: [payloads.chainId, payloads.payloadId],
          set: {
            proposalId: row.proposalId,
            chainName: row.chainName,
            payloadsController: row.payloadsController,
            state: row.state,
            stateName: row.stateName,
            actionCount: row.actionCount,
            executable: row.executable,
            refreshedAt: row.refreshedAt,
          },
        });
    }
    upserted += 1;
  }

  return {
    totalProposals: Number(total),
    inspected: ids.length,
    upserted,
    errors,
  };
};

export { proposalStateName };
