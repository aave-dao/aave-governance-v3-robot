import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import type {Address, Hex, PublicClient} from 'viem';
import {
  MULTICALL3_ADDRESS,
  governanceAbi,
  payloadsControllerAbi,
  votingMachineAbi,
} from '../core/abis';
import {
  checkActivateVoting,
  checkCancelProposal,
  checkCloseAndSendVote,
  checkCreateVote,
  checkExecuteProposal,
  checkExecutePayload,
  checkSubmitStorageRoots,
  hasRequiredRoots,
} from '../core/actions';
import {EXECUTION_CHAINS, findVotingChainByPortal, type VotingChainConfig} from '../core/chains';
import {fetchProposalMetadataSafe, type ProposalMetadata} from '../core/ipfs';
import type {Logger} from '../core/logger';
import {redactSecrets} from '../core/redact-secrets';
import {
  PayloadState,
  ProposalState,
  VotingMachineProposalState,
  payloadStateName,
  proposalStateName,
  votingProposalStateName,
} from '../core/state';

const GOVERNANCE = GovernanceV3Ethereum.GOVERNANCE as Address;

export type InspectorConfig = {
  l1Public: PublicClient;
  votingClients: Partial<Record<number, PublicClient>>;
  executionClients: Partial<Record<number, PublicClient>>;
  logger: Logger;
  /** Fetch IPFS metadata if true. Defaults to true; set false to skip the network round-trip. */
  fetchMetadata?: boolean;
};

export type ActionStatus =
  | {name: string; status: 'ready'}
  | {name: string; status: 'blocked'; reason: string; etaAt?: number}
  | {name: string; status: 'done'; reason: string};

export type InspectorReport = {
  proposalId: bigint;
  governance: {
    state: string;
    stateNumber: number;
    creationTime: number;
    votingActivationTime: number;
    queuingTime: number;
    /** Per-proposal: time spent in Active state. Lifted from the proposal struct. */
    votingDuration: number;
    /** Contract-level: gap between Queued and Executed. From COOLDOWN_PERIOD(). */
    cooldownPeriod: number;
    /** Per-access-level: gap between Created and Active. From getVotingConfig(). */
    coolDownBeforeVotingStart: number;
    creator: Address;
    snapshotBlockHash: Hex;
    ipfsHash: Hex;
    votingPortal: Address;
    actions: ActionStatus[];
  };
  metadata?: ProposalMetadata;
  metadataError?: string;
  voting?: {
    chain: string;
    chainId: number;
    state: string;
    stateNumber: number;
    l1ProposalBlockHash: Hex;
    actions: ActionStatus[];
  };
  payloads: Array<{
    chainId: number;
    chainName: string;
    payloadId: number;
    payloadsController: Address;
    state: string;
    stateNumber: number;
    actionCount: number;
    actions: ActionStatus[];
  }>;
  nextRecommended?: {
    stage: 'governance' | 'voting' | 'payload';
    action: string;
    chainId: number;
    id: bigint;
  };
};

const buildActionStatus = async (
  name: string,
  fn: () => Promise<{ok: true} | {ok: false; reason: string}>,
  doneReason?: string,
  /** Unix-seconds timestamp when this blocked action would become ready (best-effort). */
  etaAt?: number,
): Promise<ActionStatus> => {
  try {
    const result = await fn();
    if (result.ok) return {name, status: 'ready'};
    if (doneReason) return {name, status: 'done', reason: doneReason};
    return {name, status: 'blocked', reason: result.reason, etaAt};
  } catch (err) {
    return {
      name,
      status: 'blocked',
      reason: redactSecrets(err instanceof Error ? err.message : String(err)),
      etaAt,
    };
  }
};

export const inspectProposal = async (
  config: InspectorConfig,
  proposalId: bigint,
): Promise<InspectorReport> => {
  const {l1Public, logger} = config;
  const proposal = await l1Public.readContract({
    address: GOVERNANCE,
    abi: governanceAbi,
    functionName: 'getProposal',
    args: [proposalId],
  });

  // Kick off IPFS fetch in parallel with state reads — typical IPFS roundtrip dominates.
  const metadataPromise =
    config.fetchMetadata === false
      ? Promise.resolve(undefined)
      : fetchProposalMetadataSafe(proposal.ipfsHash as Hex);

  // "Done" = the proposal has moved past the lifecycle stage this action targets.
  // Mark these in the report with the same ✓ glyph so the user sees what's already settled.
  const isPastActivate = proposal.state >= ProposalState.Active;
  const isExecuted = proposal.state === ProposalState.Executed;
  const isCancelled = proposal.state === ProposalState.Cancelled;
  const isFailedOrExpired =
    proposal.state === ProposalState.Failed || proposal.state === ProposalState.Expired;

  // ETA inputs — fetched once from L1 in a single multicall, reused across each blocked action.
  const [cooldownPeriod, votingConfig] = await l1Public.multicall({
    contracts: [
      {address: GOVERNANCE, abi: governanceAbi, functionName: 'COOLDOWN_PERIOD' as const},
      {
        address: GOVERNANCE,
        abi: governanceAbi,
        functionName: 'getVotingConfig' as const,
        args: [proposal.accessLevel] as const,
      },
    ],
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
  });

  const activateEtaAt =
    proposal.state === ProposalState.Created
      ? proposal.creationTime + Number(votingConfig.coolDownBeforeVotingStart)
      : undefined;
  const executeEtaAt =
    proposal.state === ProposalState.Queued
      ? proposal.queuingTime + Number(cooldownPeriod)
      : undefined;

  const [govActions] = await Promise.all([
    Promise.all([
      buildActionStatus(
        'activateVoting',
        () => checkActivateVoting({chainId: 1, publicClient: l1Public, logger}, proposalId),
        isPastActivate ? `proposal ${proposalStateName(proposal.state).toLowerCase()}` : undefined,
        activateEtaAt,
      ),
      buildActionStatus(
        'executeProposal',
        () => checkExecuteProposal({chainId: 1, publicClient: l1Public, logger}, proposalId),
        isExecuted
          ? 'proposal executed'
          : isFailedOrExpired || isCancelled
            ? `proposal ${proposalStateName(proposal.state).toLowerCase()} — execution skipped`
            : undefined,
        executeEtaAt,
      ),
      buildActionStatus(
        'cancelProposal',
        () => checkCancelProposal({chainId: 1, publicClient: l1Public, logger}, proposalId),
        isCancelled ? 'proposal cancelled' : undefined,
      ),
    ]),
  ]);

  const portal = proposal.votingPortal;
  let voting: InspectorReport['voting'];
  let votingChain: VotingChainConfig | undefined;
  if (portal && portal !== '0x0000000000000000000000000000000000000000') {
    votingChain = findVotingChainByPortal(portal);
  }

  if (votingChain) {
    const vmClient = config.votingClients[votingChain.chainId];
    if (!vmClient) {
      logger.warn(
        `no RPC configured for voting chain ${votingChain.name} — skipping voting inspection`,
      );
    } else {
      const ctx = {chainId: votingChain.chainId, publicClient: vmClient, logger};
      let vmState = -1;
      let vmBridgedHash: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000';
      let vmEndTime: number | undefined;
      try {
        // Single multicall: state + voteConfig + getProposalById. allowFailure=true because
        // getProposalById reverts on NotCreated (we don't care, we just won't get endTime).
        const [stateResult, voteConfigResult, vmProposalResult] = await vmClient.multicall({
          contracts: [
            {
              address: votingChain.votingMachine,
              abi: votingMachineAbi,
              functionName: 'getProposalState' as const,
              args: [proposalId] as const,
            },
            {
              address: votingChain.votingMachine,
              abi: votingMachineAbi,
              functionName: 'getProposalVoteConfiguration' as const,
              args: [proposalId] as const,
            },
            {
              address: votingChain.votingMachine,
              abi: votingMachineAbi,
              functionName: 'getProposalById' as const,
              args: [proposalId] as const,
            },
          ],
          allowFailure: true,
          multicallAddress: MULTICALL3_ADDRESS,
        });

        if (stateResult.status === 'success') vmState = stateResult.result;
        if (voteConfigResult.status === 'success') {
          vmBridgedHash = voteConfigResult.result.l1ProposalBlockHash as Hex;
        }
        if (vmProposalResult.status === 'success' && vmState >= VotingMachineProposalState.Active) {
          vmEndTime = vmProposalResult.result.endTime;
        }
      } catch (err) {
        logger.warn('inspector: voting machine read failed', {
          chain: votingChain.name,
          error: redactSecrets(err instanceof Error ? err.message : String(err)),
        });
      }

      // Source-of-truth for "do we know which L1 block to prove?" is the L1 governance
      // proposal's snapshotBlockHash — set as soon as activateVoting runs, even before the
      // cross-chain message reaches the voting chain.
      const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';
      const l1Hash =
        proposal.snapshotBlockHash !== ZERO ? (proposal.snapshotBlockHash as Hex) : vmBridgedHash;
      const rootsReady = l1Hash !== ZERO ? await hasRequiredRoots(ctx, votingChain, l1Hash) : false;

      const isPastNotCreated = vmState > VotingMachineProposalState.NotCreated;
      const isVoteSent = vmState === VotingMachineProposalState.SentToGovernance;

      const closeEtaAt =
        vmState === VotingMachineProposalState.Active && vmEndTime ? vmEndTime : undefined;

      const votingActions: ActionStatus[] = [
        await buildActionStatus(
          'submitStorageRoots',
          () => checkSubmitStorageRoots(ctx, {proposalId, l1ProposalBlockHash: l1Hash}),
          rootsReady ? 'roots registered' : undefined,
        ),
        await buildActionStatus(
          'createVote',
          () => checkCreateVote(ctx, proposalId),
          isPastNotCreated ? 'voting started' : undefined,
        ),
        await buildActionStatus(
          'closeAndSendVote',
          () => checkCloseAndSendVote(ctx, proposalId),
          isVoteSent ? 'results sent to L1' : undefined,
          closeEtaAt,
        ),
      ];

      voting = {
        chain: votingChain.name,
        chainId: votingChain.chainId,
        state: votingProposalStateName(vmState),
        stateNumber: vmState,
        l1ProposalBlockHash: l1Hash,
        actions: votingActions,
      };
    }
  }

  const payloads: InspectorReport['payloads'] = [];
  for (const ref of proposal.payloads) {
    const exec = EXECUTION_CHAINS[Number(ref.chain)];
    const chainName = exec?.name ?? `chain-${ref.chain}`;
    const payloadId = Number(ref.payloadId);
    const client = config.executionClients[Number(ref.chain)];
    const payloadsController = (exec?.payloadsController ?? ref.payloadsController) as Address;

    if (!client || !exec) {
      payloads.push({
        chainId: Number(ref.chain),
        chainName,
        payloadId,
        payloadsController,
        state: 'unknown (no RPC configured)',
        stateNumber: -1,
        actionCount: 0,
        actions: [],
      });
      continue;
    }

    try {
      const payload = await client.readContract({
        address: payloadsController,
        abi: payloadsControllerAbi,
        functionName: 'getPayloadById',
        args: [payloadId],
      });
      const payloadDoneReason =
        payload.state === PayloadState.Executed
          ? 'payload executed'
          : payload.state === PayloadState.Cancelled
            ? 'payload cancelled'
            : payload.state === PayloadState.Expired
              ? 'payload expired'
              : undefined;
      // ETA only known once the payload is queued — before that, it depends on the L1
      // proposal executing + cross-chain bridging + queue, none of which has a fixed clock.
      const payloadEtaAt =
        payload.state === PayloadState.Queued ? payload.queuedAt + payload.delay : undefined;
      const action = await buildActionStatus(
        'executePayload',
        () =>
          checkExecutePayload(
            {chainId: Number(ref.chain), publicClient: client, logger},
            BigInt(payloadId),
          ),
        payloadDoneReason,
        payloadEtaAt,
      );
      payloads.push({
        chainId: Number(ref.chain),
        chainName,
        payloadId,
        payloadsController,
        state: payloadStateName(payload.state),
        stateNumber: payload.state,
        actionCount: payload.actions.length,
        actions: [action],
      });
    } catch (err) {
      payloads.push({
        chainId: Number(ref.chain),
        chainName,
        payloadId,
        payloadsController,
        state: `error: ${redactSecrets(err instanceof Error ? err.message : String(err))}`,
        stateNumber: -1,
        actionCount: 0,
        actions: [],
      });
    }
  }

  const nextRecommended = pickNext(govActions, voting?.actions, payloads);

  let metadata: ProposalMetadata | undefined;
  let metadataError: string | undefined;
  try {
    metadata = await metadataPromise;
    if (config.fetchMetadata !== false && !metadata) {
      metadataError = 'failed to fetch from any IPFS gateway';
    }
  } catch (err) {
    metadataError = redactSecrets(err instanceof Error ? err.message : String(err));
  }

  return {
    proposalId,
    governance: {
      state: proposalStateName(proposal.state),
      stateNumber: proposal.state,
      creationTime: proposal.creationTime,
      votingActivationTime: proposal.votingActivationTime,
      queuingTime: proposal.queuingTime,
      votingDuration: Number(proposal.votingDuration),
      cooldownPeriod: Number(cooldownPeriod),
      coolDownBeforeVotingStart: Number(votingConfig.coolDownBeforeVotingStart),
      creator: proposal.creator,
      snapshotBlockHash: proposal.snapshotBlockHash as Hex,
      ipfsHash: proposal.ipfsHash as Hex,
      votingPortal: portal,
      actions: govActions,
    },
    metadata,
    metadataError,
    voting,
    payloads,
    nextRecommended: nextRecommended
      ? {
          ...nextRecommended,
          id: nextRecommended.stage === 'payload' ? nextRecommended.id : proposalId,
        }
      : undefined,
  };
};

const pickNext = (
  gov: ActionStatus[],
  voting: ActionStatus[] | undefined,
  payloads: InspectorReport['payloads'],
):
  | {stage: 'governance' | 'voting' | 'payload'; action: string; chainId: number; id: bigint}
  | undefined => {
  for (const a of gov)
    if (a.status === 'ready') return {stage: 'governance', action: a.name, chainId: 1, id: 0n};
  if (voting) {
    for (const a of voting)
      if (a.status === 'ready') return {stage: 'voting', action: a.name, chainId: 0, id: 0n};
  }
  for (const p of payloads) {
    for (const a of p.actions) {
      if (a.status === 'ready')
        return {stage: 'payload', action: a.name, chainId: p.chainId, id: BigInt(p.payloadId)};
    }
  }
  return undefined;
};
