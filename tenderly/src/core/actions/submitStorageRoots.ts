import { encodeFunctionData, type Address, type Hex } from 'viem';
import { dataWarehouseAbi } from '../abis';
import {
  GOVERNANCE_TOKENS,
  STK_AAVE_EXCHANGE_RATE_SLOT,
  VOTING_CHAINS,
  type VotingChainConfig,
  type VotingChainId,
} from '../chains';
import { sendAggregate3, type Call3 } from '../multicall';
import { formatToProofRLP, prepareBlockRLP } from '../proofs';
import { getProof, getRawBlockByHash } from '../rpc';
import type { CheckResult, ExecuteResult, ReadContext, WriteContext } from '../context';
import { hasRequiredRoots } from './createVote';

const requireVotingChain = (chainId: number): VotingChainConfig => {
  const config = VOTING_CHAINS[chainId as VotingChainId];
  if (!config) throw new Error(`chainId ${chainId} is not a voting chain`);
  return config;
};

/**
 * Generate the 5 calls (4× processStorageRoot + 1× processStorageSlot) needed to
 * register voting roots for `snapshotBlockHash` on the given voting chain.
 *
 * Pulls block + 4 account proofs from L1 (governance chain) via `eth_getProof`,
 * then RLP-encodes them per DataWarehouse's expected format.
 */
export const buildStorageRootCalls = async (
  ethRpcUrl: string,
  config: VotingChainConfig,
  snapshotBlockHash: Hex,
): Promise<Call3[]> => {
  const block = await getRawBlockByHash(ethRpcUrl, snapshotBlockHash);
  if (!block || !block.number) {
    throw new Error(`block ${snapshotBlockHash} not found via eth_getBlockByHash`);
  }
  const blockNumber = block.number as Hex;
  const blockHeaderRLP = prepareBlockRLP(block);

  const [aaveProof, aAaveProof, stkAaveProof, governanceProof] = await Promise.all([
    getProof(ethRpcUrl, GOVERNANCE_TOKENS.aave, [], blockNumber),
    getProof(ethRpcUrl, GOVERNANCE_TOKENS.aAave, [], blockNumber),
    getProof(ethRpcUrl, GOVERNANCE_TOKENS.stkAave, [STK_AAVE_EXCHANGE_RATE_SLOT], blockNumber),
    getProof(ethRpcUrl, config.governance, [], blockNumber),
  ]);

  const stkSlotProof = stkAaveProof.storageProof[0];
  if (!stkSlotProof) {
    throw new Error('stkAAVE storage proof for exchange-rate slot is missing');
  }

  const calls: Array<{ token: Address; proofRLP: Hex; label: string }> = [
    { token: GOVERNANCE_TOKENS.aave, proofRLP: formatToProofRLP(aaveProof.accountProof), label: 'AAVE' },
    { token: GOVERNANCE_TOKENS.aAave, proofRLP: formatToProofRLP(aAaveProof.accountProof), label: 'aAAVE' },
    { token: GOVERNANCE_TOKENS.stkAave, proofRLP: formatToProofRLP(stkAaveProof.accountProof), label: 'stkAAVE' },
    { token: config.governance, proofRLP: formatToProofRLP(governanceProof.accountProof), label: 'Governance' },
  ];

  const out: Call3[] = calls.map(({ token, proofRLP }) => ({
    target: config.dataWarehouse,
    allowFailure: true,
    callData: encodeFunctionData({
      abi: dataWarehouseAbi,
      functionName: 'processStorageRoot',
      args: [token, snapshotBlockHash, blockHeaderRLP, proofRLP],
    }),
  }));

  out.push({
    target: config.dataWarehouse,
    allowFailure: true,
    callData: encodeFunctionData({
      abi: dataWarehouseAbi,
      functionName: 'processStorageSlot',
      args: [
        GOVERNANCE_TOKENS.stkAave,
        snapshotBlockHash,
        STK_AAVE_EXCHANGE_RATE_SLOT,
        formatToProofRLP(stkSlotProof.proof),
      ],
    }),
  });

  return out;
};

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

/** Returns ok if there's a real snapshot block hash and the voting chain doesn't yet have roots. */
export const checkSubmitStorageRoots = async (
  ctx: ReadContext,
  args: { proposalId: bigint; l1ProposalBlockHash: Hex },
): Promise<CheckResult> => {
  if (args.l1ProposalBlockHash === ZERO_HASH) {
    return { ok: false, reason: 'no snapshot block hash yet (proposal not yet activated on L1)' };
  }
  const config = requireVotingChain(ctx.chainId);
  const ready = await hasRequiredRoots(ctx, config, args.l1ProposalBlockHash);
  if (ready) return { ok: false, reason: 'roots already registered for this snapshot block' };
  return { ok: true };
};

/**
 * Fetches proofs from L1 and submits the 5 DataWarehouse calls in a single Multicall3.aggregate3
 * tx with allowFailure=true (so a partial overlap with the Chainlink keeper or RootsConsumer
 * doesn't abort the whole batch).
 */
export const executeSubmitStorageRoots = async (
  ctx: WriteContext & { ethRpcUrl: string },
  args: { proposalId: bigint; l1ProposalBlockHash: Hex },
): Promise<ExecuteResult> => {
  const config = requireVotingChain(ctx.chainId);

  const check = await checkSubmitStorageRoots(ctx, args);
  if (!check.ok) throw new Error(`submitStorageRoots precheck failed: ${check.reason}`);

  ctx.logger.info('submitStorageRoots: building proofs', {
    proposalId: args.proposalId.toString(),
    blockHash: args.l1ProposalBlockHash,
    chain: config.name,
  });

  const calls = await buildStorageRootCalls(ctx.ethRpcUrl, config, args.l1ProposalBlockHash);

  ctx.logger.info('submitStorageRoots: sending Multicall3.aggregate3', {
    callCount: calls.length,
    chain: config.name,
  });

  const txHash = await sendAggregate3(ctx.walletClient, calls);
  ctx.logger.info('submitStorageRoots: submitted', {
    proposalId: args.proposalId.toString(),
    txHash,
    chain: config.name,
  });
  return { txHash };
};
