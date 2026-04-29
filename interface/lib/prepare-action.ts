// Build an unsigned transaction for any of the keeper actions.
// The server runs the same eligibility check the on-the-server signer would, then ABI-encodes
// the call so the browser wallet can sign + broadcast it. The submitStorageRoots path also
// builds the L1 storage proofs server-side because the browser doesn't have an L1 RPC.

import { GovernanceV3Ethereum } from '@aave-dao/aave-address-book';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import {
  governanceAbi,
  payloadsControllerAbi,
  votingMachineAbi,
  multicall3Abi,
  MULTICALL3_ADDRESS,
  dataWarehouseAbi,
} from '@robot/core/abis';
import {
  EXECUTION_CHAINS,
  GOVERNANCE_CHAIN_ID,
  VOTING_CHAINS,
  findVotingChainByPortal,
  type VotingChainId,
} from '@robot/core/chains';
import {
  activateVotingAction,
  buildStorageRootEntries,
  cancelProposalAction,
  checkSubmitStorageRoots,
  closeAndSendVoteAction,
  createVoteAction,
  executePayloadAction,
  executeProposalAction,
  type SubmitRootsResult,
} from '@robot/core/actions';
import { ethRpcUrlFromEnv, makeReadContextFromEnv } from './context-factory';

export type ActionName =
  | 'activateVoting'
  | 'executeProposal'
  | 'cancelProposal'
  | 'submitStorageRoots'
  | 'createVote'
  | 'closeAndSendVote'
  | 'executePayload';

export type PreparedTx = {
  chainId: number;
  to: Address;
  data: Hex;
  /** Wei as decimal string (always '0' for keeper actions; reserved for future). */
  value: string;
};

export type PrepareResult =
  | { ok: true; tx: PreparedTx }
  | { ok: false; reason: string; skipped?: SubmitRootsResult };

type Args = {
  action: ActionName;
  /** decimal string proposal id or payload id */
  id: string;
  /** required for createVote/closeAndSendVote (voting chain) and executePayload (exec chain) */
  chainId?: number;
};

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

const ensure = <T>(v: T | undefined | null, msg: string): T => {
  if (v === undefined || v === null) throw new Error(msg);
  return v;
};

export const prepareAction = async ({
  action,
  id,
  chainId,
}: Args): Promise<PrepareResult> => {
  const bigintId = BigInt(id);

  if (action === 'activateVoting' || action === 'executeProposal' || action === 'cancelProposal') {
    const ctx = makeReadContextFromEnv(GOVERNANCE_CHAIN_ID, 'ethereum');
    const mod =
      action === 'activateVoting'
        ? activateVotingAction
        : action === 'executeProposal'
          ? executeProposalAction
          : cancelProposalAction;
    const check = await mod.check(ctx, bigintId);
    if (!check.ok) return { ok: false, reason: `${action} not eligible: ${check.reason}` };
    const data = encodeFunctionData({
      abi: governanceAbi,
      functionName: action,
      args: [bigintId],
    });
    return {
      ok: true,
      tx: {
        chainId: GOVERNANCE_CHAIN_ID,
        to: GovernanceV3Ethereum.GOVERNANCE as Address,
        data,
        value: '0',
      },
    };
  }

  if (action === 'createVote' || action === 'closeAndSendVote') {
    const cid = ensure(chainId, `${action} requires chainId (voting chain)`);
    const cfg = VOTING_CHAINS[cid as VotingChainId];
    if (!cfg) throw new Error(`chainId ${cid} is not a voting chain`);
    const ctx = makeReadContextFromEnv(cid, cfg.name);
    const mod = action === 'createVote' ? createVoteAction : closeAndSendVoteAction;
    const check = await mod.check(ctx, bigintId);
    if (!check.ok) return { ok: false, reason: `${action} not eligible: ${check.reason}` };
    const fn = action === 'createVote' ? 'startProposalVote' : 'closeAndSendVote';
    const data = encodeFunctionData({
      abi: votingMachineAbi,
      functionName: fn,
      args: [bigintId],
    });
    return {
      ok: true,
      tx: {
        chainId: cid,
        to: cfg.votingMachine,
        data,
        value: '0',
      },
    };
  }

  if (action === 'executePayload') {
    const cid = ensure(chainId, 'executePayload requires chainId (execution chain)');
    const cfg = EXECUTION_CHAINS[cid];
    if (!cfg) throw new Error(`chainId ${cid} has no PayloadsController configured`);
    const ctx = makeReadContextFromEnv(cid, cfg.name);
    const check = await executePayloadAction.check(ctx, bigintId);
    if (!check.ok) return { ok: false, reason: `executePayload not eligible: ${check.reason}` };
    const data = encodeFunctionData({
      abi: payloadsControllerAbi,
      functionName: 'executePayload',
      args: [Number(bigintId)],
    });
    return {
      ok: true,
      tx: {
        chainId: cid,
        to: cfg.payloadsController,
        data,
        value: '0',
      },
    };
  }

  if (action === 'submitStorageRoots') {
    return prepareSubmitStorageRoots(bigintId);
  }

  throw new Error(`unknown action: ${action satisfies never}`);
};

// ─── submitStorageRoots: build proofs + multicall calldata ─────────────────────

const prepareSubmitStorageRoots = async (proposalId: bigint): Promise<PrepareResult> => {
  // Resolve voting chain via the proposal's votingPortal (same logic as the server dispatcher).
  const govCtx = makeReadContextFromEnv(GOVERNANCE_CHAIN_ID, 'ethereum');
  const proposal = await govCtx.publicClient.readContract({
    address: GovernanceV3Ethereum.GOVERNANCE as Address,
    abi: governanceAbi,
    functionName: 'getProposal',
    args: [proposalId],
  });
  const portal = proposal.votingPortal as Address;
  const votingChain = findVotingChainByPortal(portal);
  if (!votingChain) {
    throw new Error(`no voting chain for portal ${portal}`);
  }
  const blockHash = proposal.snapshotBlockHash as Hex;
  const ctx = makeReadContextFromEnv(votingChain.chainId, votingChain.name);

  // Eligibility check first.
  const check = await checkSubmitStorageRoots(ctx, {
    proposalId,
    l1ProposalBlockHash: blockHash,
  });
  if (!check.ok) {
    return {
      ok: false,
      reason: `submitStorageRoots not eligible: ${check.reason}`,
      skipped: { skipped: check.reason },
    };
  }

  // Build proof entries server-side (uses L1 RPC).
  const entries = await buildStorageRootEntries(
    ethRpcUrlFromEnv(),
    votingChain,
    blockHash,
    ctx.logger,
  );

  // Skip the entries already registered with matching values, mirroring planBatch's logic.
  const reads = await ctx.publicClient.multicall({
    contracts: entries.map((e) =>
      e.kind === 'root'
        ? {
            address: votingChain.dataWarehouse,
            abi: dataWarehouseAbi,
            functionName: 'getStorageRoots' as const,
            args: [e.account, blockHash] as const,
          }
        : {
            address: votingChain.dataWarehouse,
            abi: dataWarehouseAbi,
            functionName: 'getRegisteredSlot' as const,
            args: [blockHash, e.account, e.slot] as const,
          },
    ),
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
  });

  const toSend = entries.filter((e, i) => {
    if (e.kind === 'root') {
      const registered = reads[i] as Hex;
      if (registered === ZERO_HASH) return true;
      return registered.toLowerCase() !== e.expected.toLowerCase();
    }
    const registered = reads[i] as bigint;
    if (registered === 0n) return true;
    return registered !== e.expectedValue;
  });

  if (toSend.length === 0) {
    return {
      ok: false,
      reason: `all ${entries.length} roots already registered`,
      skipped: { skipped: 'all roots already registered' },
    };
  }

  const data = encodeFunctionData({
    abi: multicall3Abi,
    functionName: 'aggregate3',
    args: [toSend.map((e) => e.call)],
  });
  return {
    ok: true,
    tx: {
      chainId: votingChain.chainId,
      to: MULTICALL3_ADDRESS,
      data,
      value: '0',
    },
  };
};

