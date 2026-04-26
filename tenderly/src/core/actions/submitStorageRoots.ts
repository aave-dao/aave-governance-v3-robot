import {encodeFunctionData, type Address, type Hex} from 'viem';
import {dataWarehouseAbi} from '../abis';
import {
  GOVERNANCE_TOKENS,
  STK_AAVE_EXCHANGE_RATE_SLOT,
  VOTING_CHAINS,
  type VotingChainConfig,
  type VotingChainId,
} from '../chains';
import {sendAggregate3, type Call3} from '../multicall';
import {formatToProofRLP, prepareBlockRLP} from '../proofs';
import {getProof, getRawBlockByHash} from '../rpc';
import type {CheckResult, ExecuteResult, ReadContext, WriteContext} from '../context';
import {hasRequiredRoots} from './createVote';

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
  logger?: {
    trace: (m: string, meta?: Record<string, unknown>) => void;
    debug: (m: string, meta?: Record<string, unknown>) => void;
  },
): Promise<Call3[]> => {
  logger?.trace('buildStorageRootCalls: fetching block', {snapshotBlockHash});
  const block = await getRawBlockByHash(ethRpcUrl, snapshotBlockHash);
  if (!block || !block.number) {
    throw new Error(`block ${snapshotBlockHash} not found via eth_getBlockByHash`);
  }
  const blockNumber = block.number as Hex;
  const blockHeaderRLP = prepareBlockRLP(block);
  logger?.debug('buildStorageRootCalls: block + header ready', {
    blockNumber,
    blockHeaderRLPBytes: (blockHeaderRLP.length - 2) / 2,
  });

  logger?.trace('buildStorageRootCalls: fetching 4 account proofs in parallel');
  const [aaveProof, aAaveProof, stkAaveProof, governanceProof] = await Promise.all([
    getProof(ethRpcUrl, GOVERNANCE_TOKENS.aave, [], blockNumber),
    getProof(ethRpcUrl, GOVERNANCE_TOKENS.aAave, [], blockNumber),
    getProof(ethRpcUrl, GOVERNANCE_TOKENS.stkAave, [STK_AAVE_EXCHANGE_RATE_SLOT], blockNumber),
    getProof(ethRpcUrl, config.governance, [], blockNumber),
  ]);
  logger?.debug('buildStorageRootCalls: proofs received', {
    aaveNodes: aaveProof.accountProof.length,
    aAaveNodes: aAaveProof.accountProof.length,
    stkAaveNodes: stkAaveProof.accountProof.length,
    governanceNodes: governanceProof.accountProof.length,
    stkAaveSlotNodes: stkAaveProof.storageProof[0]?.proof.length ?? 0,
  });

  const stkSlotProof = stkAaveProof.storageProof[0];
  if (!stkSlotProof) {
    throw new Error('stkAAVE storage proof for exchange-rate slot is missing');
  }

  const calls: Array<{token: Address; proofRLP: Hex; label: string}> = [
    {
      token: GOVERNANCE_TOKENS.aave,
      proofRLP: formatToProofRLP(aaveProof.accountProof),
      label: 'AAVE',
    },
    {
      token: GOVERNANCE_TOKENS.aAave,
      proofRLP: formatToProofRLP(aAaveProof.accountProof),
      label: 'aAAVE',
    },
    {
      token: GOVERNANCE_TOKENS.stkAave,
      proofRLP: formatToProofRLP(stkAaveProof.accountProof),
      label: 'stkAAVE',
    },
    {
      token: config.governance,
      proofRLP: formatToProofRLP(governanceProof.accountProof),
      label: 'Governance',
    },
  ];

  const out: Call3[] = calls.map(({token, proofRLP}) => ({
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
  args: {proposalId: bigint; l1ProposalBlockHash: Hex},
): Promise<CheckResult> => {
  if (args.l1ProposalBlockHash === ZERO_HASH) {
    return {ok: false, reason: 'no snapshot block hash yet (proposal not yet activated on L1)'};
  }
  const config = requireVotingChain(ctx.chainId);
  const ready = await hasRequiredRoots(ctx, config, args.l1ProposalBlockHash);
  if (ready) return {ok: false, reason: 'roots already registered for this snapshot block'};
  return {ok: true};
};

/**
 * Low-level: submit storage roots for an arbitrary L1 block hash to a voting chain.
 * Use this when you don't have a proposal context — e.g., pre-warming roots for a custom
 * voting machine, or recovery flows. No state ready-check is performed.
 *
 * Caller decides the target `VotingChainConfig` (typically from `VOTING_CHAINS[chainId]`,
 * but the dataWarehouse can be overridden if the deployment is non-standard).
 */
export const submitStorageRootsForBlock = async (
  ctx: WriteContext & {ethRpcUrl: string},
  args: {l1BlockHash: Hex; config: VotingChainConfig},
): Promise<ExecuteResult> => {
  ctx.logger.info('submitStorageRootsForBlock: building proofs', {
    blockHash: args.l1BlockHash,
    chain: args.config.name,
    dataWarehouse: args.config.dataWarehouse,
  });

  const calls = await buildStorageRootCalls(
    ctx.ethRpcUrl,
    args.config,
    args.l1BlockHash,
    ctx.logger,
  );

  ctx.logger.info('submitStorageRootsForBlock: sending Multicall3.aggregate3', {
    callCount: calls.length,
    chain: args.config.name,
  });
  for (const [i, call] of calls.entries()) {
    ctx.logger.trace('submitStorageRootsForBlock: call', {
      index: i,
      target: call.target,
      callDataBytes: (call.callData.length - 2) / 2,
    });
  }

  const txHash = await sendAggregate3(ctx.walletClient, calls);
  ctx.logger.info('submitStorageRootsForBlock: submitted', {
    txHash,
    chain: args.config.name,
  });
  return {txHash};
};

/**
 * Fetches proofs from L1 and submits the 5 DataWarehouse calls in a single Multicall3.aggregate3
 * tx with allowFailure=true (so a partial overlap with the Chainlink keeper or RootsConsumer
 * doesn't abort the whole batch).
 */
export const executeSubmitStorageRoots = async (
  ctx: WriteContext & {ethRpcUrl: string},
  args: {proposalId: bigint; l1ProposalBlockHash: Hex},
): Promise<ExecuteResult> => {
  const config = requireVotingChain(ctx.chainId);

  const check = await checkSubmitStorageRoots(ctx, args);
  if (!check.ok) throw new Error(`submitStorageRoots precheck failed: ${check.reason}`);

  ctx.logger.info('submitStorageRoots: building proofs', {
    proposalId: args.proposalId.toString(),
    blockHash: args.l1ProposalBlockHash,
    chain: config.name,
  });

  const calls = await buildStorageRootCalls(
    ctx.ethRpcUrl,
    config,
    args.l1ProposalBlockHash,
    ctx.logger,
  );

  ctx.logger.info('submitStorageRoots: sending Multicall3.aggregate3', {
    callCount: calls.length,
    chain: config.name,
  });
  for (const [i, call] of calls.entries()) {
    ctx.logger.trace('submitStorageRoots: call', {
      index: i,
      target: call.target,
      callDataBytes: (call.callData.length - 2) / 2,
    });
  }

  const txHash = await sendAggregate3(ctx.walletClient, calls);
  ctx.logger.info('submitStorageRoots: submitted', {
    proposalId: args.proposalId.toString(),
    txHash,
    chain: config.name,
  });
  return {txHash};
};
