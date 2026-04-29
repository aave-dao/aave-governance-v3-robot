import { GovernanceV3Ethereum } from '@aave-dao/aave-address-book';
import type { Address, Hex } from 'viem';
import { governanceAbi } from '@robot/core/abis';
import {
  activateVotingAction,
  cancelProposalAction,
  closeAndSendVoteAction,
  createVoteAction,
  executePayloadAction,
  executeProposalAction,
  executeSubmitStorageRoots,
} from '@robot/core/actions';
import {
  EXECUTION_CHAINS,
  findVotingChainByPortal,
  GOVERNANCE_CHAIN_ID,
  VOTING_CHAINS,
} from '@robot/core/chains';
import {
  ethRpcUrlFromEnv,
  makeReadContextFromEnv,
  makeWriteContextFromEnv,
} from './context-factory';

export type ActionName =
  | 'activateVoting'
  | 'executeProposal'
  | 'cancelProposal'
  | 'submitStorageRoots'
  | 'createVote'
  | 'closeAndSendVote'
  | 'executePayload';

export type DispatchInput = {
  action: ActionName;
  /** proposalId for governance/voting; payloadId for executePayload (decimal string). */
  id: string;
  /** Required for executePayload (execution chain) and createVote/closeAndSendVote (voting chain). */
  chainId?: number;
};

export type DispatchResult = { txHash: Hex; chainId: number };

const ensure = <T>(v: T | undefined, msg: string): T => {
  if (v === undefined || v === null) throw new Error(msg);
  return v;
};

export const dispatchExecute = async ({
  action,
  id,
  chainId,
}: DispatchInput): Promise<DispatchResult> => {
  const bigintId = BigInt(id);

  if (action === 'activateVoting' || action === 'executeProposal' || action === 'cancelProposal') {
    const ctx = makeWriteContextFromEnv(GOVERNANCE_CHAIN_ID, 'ethereum');
    const mod =
      action === 'activateVoting'
        ? activateVotingAction
        : action === 'executeProposal'
          ? executeProposalAction
          : cancelProposalAction;
    const check = await mod.check(ctx, bigintId);
    if (!check.ok) throw new Error(`${action} not eligible: ${check.reason}`);
    const { txHash } = await mod.execute(ctx, bigintId);
    return { txHash, chainId: GOVERNANCE_CHAIN_ID };
  }

  if (action === 'createVote' || action === 'closeAndSendVote') {
    const cid = ensure(chainId, `${action} requires chainId (voting chain)`);
    if (!(cid in VOTING_CHAINS)) {
      throw new Error(`chainId ${cid} is not a voting chain`);
    }
    const ctx = makeWriteContextFromEnv(cid, VOTING_CHAINS[cid as keyof typeof VOTING_CHAINS]?.name);
    const mod = action === 'createVote' ? createVoteAction : closeAndSendVoteAction;
    const check = await mod.check(ctx, bigintId);
    if (!check.ok) throw new Error(`${action} not eligible: ${check.reason}`);
    const { txHash } = await mod.execute(ctx, bigintId);
    return { txHash, chainId: cid };
  }

  if (action === 'submitStorageRoots') {
    // Resolve voting chain from the proposal's votingPortal.
    const govCtx = makeReadContextFromEnv(GOVERNANCE_CHAIN_ID, 'ethereum');
    const proposal = await govCtx.publicClient.readContract({
      address: GovernanceV3Ethereum.GOVERNANCE as Address,
      abi: governanceAbi,
      functionName: 'getProposal',
      args: [bigintId],
    });
    const portal = proposal.votingPortal as Address;
    const votingChain = findVotingChainByPortal(portal);
    if (!votingChain) {
      throw new Error(`no voting chain for portal ${portal}`);
    }
    const ctx = makeWriteContextFromEnv(votingChain.chainId, votingChain.name);
    const result = await executeSubmitStorageRoots(
      { ...ctx, ethRpcUrl: ethRpcUrlFromEnv() },
      { proposalId: bigintId, l1ProposalBlockHash: proposal.snapshotBlockHash as Hex },
    );
    if (!result.txHash) {
      throw new Error(`submitStorageRoots skipped: ${result.skipped}`);
    }
    return { txHash: result.txHash, chainId: votingChain.chainId };
  }

  if (action === 'executePayload') {
    const cid = ensure(chainId, 'executePayload requires chainId (execution chain)');
    if (!(cid in EXECUTION_CHAINS)) {
      throw new Error(`chainId ${cid} has no PayloadsController configured`);
    }
    const ctx = makeWriteContextFromEnv(cid, EXECUTION_CHAINS[cid]?.name);
    const check = await executePayloadAction.check(ctx, bigintId);
    if (!check.ok) throw new Error(`executePayload not eligible: ${check.reason}`);
    const { txHash } = await executePayloadAction.execute(ctx, bigintId);
    return { txHash, chainId: cid };
  }

  throw new Error(`unknown action: ${action satisfies never}`);
};
