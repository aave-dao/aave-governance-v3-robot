import {
  decodeErrorResult,
  encodeFunctionData,
  hexToBigInt,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import {MULTICALL3_ADDRESS, dataWarehouseAbi, multicall3Abi} from '../abis';
import {
  GOVERNANCE_TOKENS,
  STK_AAVE_EXCHANGE_RATE_SLOT,
  VOTING_CHAINS,
  type VotingChainConfig,
  type VotingChainId,
} from '../chains';
import {sendAggregate3, type Call3} from '../multicall';
import {formatToProofRLP, prepareBlockRLP} from '../proofs';
import {getProof, getRawBlockByHash, type EthGetProofResult} from '../rpc';
import type {CheckResult, ExecuteResult, ReadContext, WriteContext} from '../context';
import {notifyTxSuccess} from '../notify';
import {hasRequiredRoots} from './createVote';

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

const requireVotingChain = (chainId: number): VotingChainConfig => {
  const config = VOTING_CHAINS[chainId as VotingChainId];
  if (!config) throw new Error(`chainId ${chainId} is not a voting chain`);
  return config;
};

/**
 * One entry of the storage-roots batch. Each entry knows three things:
 *   1. The Multicall3 `Call3` to send if the warehouse doesn't already have it.
 *   2. The target's identity (account, optional slot) — used to read the current value
 *      from the warehouse for comparison.
 *   3. The *expected* value — the storage root or slot value we'd be registering. This
 *      comes straight from `eth_getProof` (`storageHash` for accounts; `storageProof[0].value`
 *      for slots), so there's no need to re-derive it from the RLP proof we're about to submit.
 */
type BuiltRootEntry = {
  kind: 'root';
  account: Address;
  expected: Hex; // 32-byte storage root (eth_getProof.storageHash)
  call: Call3;
};
type BuiltSlotEntry = {
  kind: 'slot';
  account: Address;
  slot: Hex;
  expectedValue: bigint; // numeric slot value (eth_getProof.storageProof[i].value)
  call: Call3;
};
export type BuiltEntry = BuiltRootEntry | BuiltSlotEntry;

// `allowFailure: false` on every Call3 — we want any inner revert (bad proof, broken
// header, contract bug) to abort the whole aggregate3 tx so the wrapper's notifyError
// surfaces it. The pre-flight inspect already filters out entries the warehouse already
// has, and processStorageRoot is idempotent on duplicate writes (mapping overwrite, no
// revert), so a race with another submitter still won't trigger a revert.
const buildRootEntry = (
  config: VotingChainConfig,
  account: Address,
  proof: EthGetProofResult,
  blockHash: Hex,
  blockHeaderRLP: Hex,
): BuiltRootEntry => ({
  kind: 'root',
  account,
  expected: proof.storageHash as Hex,
  call: {
    target: config.dataWarehouse,
    allowFailure: false,
    callData: encodeFunctionData({
      abi: dataWarehouseAbi,
      functionName: 'processStorageRoot',
      args: [account, blockHash, blockHeaderRLP, formatToProofRLP(proof.accountProof)],
    }),
  },
});

const buildSlotEntry = (
  config: VotingChainConfig,
  account: Address,
  slot: Hex,
  proofNodes: Hex[],
  expectedValueHex: Hex,
  blockHash: Hex,
): BuiltSlotEntry => ({
  kind: 'slot',
  account,
  slot,
  expectedValue: hexToBigInt(expectedValueHex),
  call: {
    target: config.dataWarehouse,
    allowFailure: false,
    callData: encodeFunctionData({
      abi: dataWarehouseAbi,
      functionName: 'processStorageSlot',
      args: [account, blockHash, slot, formatToProofRLP(proofNodes)],
    }),
  },
});

/**
 * Generate the 5 entries (4× processStorageRoot + 1× processStorageSlot) needed to
 * register voting roots for `snapshotBlockHash` on the given voting chain.
 *
 * Returns BuiltEntry[] (call + expected value), not just calls — the caller compares
 * the expected values to whatever's already in the DataWarehouse before sending.
 */
export const buildStorageRootEntries = async (
  ethRpcUrls: string | string[],
  config: VotingChainConfig,
  snapshotBlockHash: Hex,
  logger?: {
    trace: (m: string, meta?: Record<string, unknown>) => void;
    debug: (m: string, meta?: Record<string, unknown>) => void;
  },
): Promise<BuiltEntry[]> => {
  logger?.trace('buildStorageRootEntries: fetching block', {snapshotBlockHash});
  const block = await getRawBlockByHash(ethRpcUrls, snapshotBlockHash);
  if (!block || !block.number) {
    throw new Error(`block ${snapshotBlockHash} not found via eth_getBlockByHash`);
  }
  const blockNumber = block.number as Hex;
  const blockHeaderRLP = prepareBlockRLP(block);
  logger?.debug('buildStorageRootEntries: block + header ready', {
    blockNumber,
    blockHeaderRLPBytes: (blockHeaderRLP.length - 2) / 2,
  });

  logger?.trace('buildStorageRootEntries: fetching 4 account proofs in parallel');
  const [aaveProof, aAaveProof, stkAaveProof, governanceProof] = await Promise.all([
    getProof(ethRpcUrls, GOVERNANCE_TOKENS.aave, [], blockNumber),
    getProof(ethRpcUrls, GOVERNANCE_TOKENS.aAave, [], blockNumber),
    getProof(ethRpcUrls, GOVERNANCE_TOKENS.stkAave, [STK_AAVE_EXCHANGE_RATE_SLOT], blockNumber),
    getProof(ethRpcUrls, config.governance, [], blockNumber),
  ]);
  logger?.debug('buildStorageRootEntries: proofs received', {
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

  return [
    buildRootEntry(config, GOVERNANCE_TOKENS.aave, aaveProof, snapshotBlockHash, blockHeaderRLP),
    buildRootEntry(config, GOVERNANCE_TOKENS.aAave, aAaveProof, snapshotBlockHash, blockHeaderRLP),
    buildRootEntry(config, GOVERNANCE_TOKENS.stkAave, stkAaveProof, snapshotBlockHash, blockHeaderRLP),
    buildRootEntry(config, config.governance, governanceProof, snapshotBlockHash, blockHeaderRLP),
    buildSlotEntry(
      config,
      GOVERNANCE_TOKENS.stkAave,
      STK_AAVE_EXCHANGE_RATE_SLOT,
      stkSlotProof.proof,
      stkSlotProof.value,
      snapshotBlockHash,
    ),
  ];
};

/** Backward-compat shim — `buildStorageRootCalls` still exists for any external callers. */
export const buildStorageRootCalls = async (
  ethRpcUrls: string | string[],
  config: VotingChainConfig,
  snapshotBlockHash: Hex,
  logger?: Parameters<typeof buildStorageRootEntries>[3],
): Promise<Call3[]> => {
  const entries = await buildStorageRootEntries(ethRpcUrls, config, snapshotBlockHash, logger);
  return entries.map((e) => e.call);
};

type EntryStatus =
  | {status: 'missing'; entry: BuiltEntry}
  | {status: 'match'; entry: BuiltEntry}
  | {status: 'mismatch'; entry: BuiltEntry; registered: string};

/**
 * Read the current registered values from DataWarehouse for every entry in one multicall.
 * Compare each with the expected value derived from `eth_getProof` and classify per entry.
 *
 * - `missing`: warehouse returned zero. We need to submit this entry.
 * - `match`: registered value equals what we'd submit. Skip safely.
 * - `mismatch`: registered value is non-zero AND differs from ours. The warehouse holds a
 *   different proof for this (account, blockHash) — refuse to submit and let the caller
 *   throw, which fires the alert pipeline.
 */
const inspectExisting = async (
  ctx: ReadContext,
  config: VotingChainConfig,
  blockHash: Hex,
  entries: BuiltEntry[],
): Promise<EntryStatus[]> => {
  const reads = await ctx.publicClient.multicall({
    contracts: entries.map((e) =>
      e.kind === 'root'
        ? {
            address: config.dataWarehouse,
            abi: dataWarehouseAbi,
            functionName: 'getStorageRoots' as const,
            args: [e.account, blockHash] as const,
          }
        : {
            address: config.dataWarehouse,
            abi: dataWarehouseAbi,
            functionName: 'getRegisteredSlot' as const,
            args: [blockHash, e.account, e.slot] as const,
          },
    ),
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
  });

  return entries.map((entry, i): EntryStatus => {
    const raw = reads[i];
    if (entry.kind === 'root') {
      const registered = raw as Hex;
      if (registered === ZERO_HASH) return {status: 'missing', entry};
      if (registered.toLowerCase() === entry.expected.toLowerCase()) return {status: 'match', entry};
      return {status: 'mismatch', entry, registered};
    }
    // slot
    const registered = raw as bigint;
    if (registered === 0n) return {status: 'missing', entry};
    if (registered === entry.expectedValue) return {status: 'match', entry};
    return {status: 'mismatch', entry, registered: registered.toString()};
  });
};

const summarizeEntry = (e: BuiltEntry): string =>
  e.kind === 'root' ? `root[${e.account}]` : `slot[${e.account}@${e.slot}]`;

/**
 * Mismatches indicate the warehouse already holds a *different* proof for the same
 * (account, blockHash). That should never happen on a healthy chain, so we throw and let
 * the alert pipeline (Slack/Telegram) wake someone up.
 */
const assertNoMismatches = (results: EntryStatus[]): void => {
  const mismatches = results.filter((r) => r.status === 'mismatch');
  if (mismatches.length === 0) return;
  const lines = mismatches.map((r) => {
    const e = r.entry;
    const expected = e.kind === 'root' ? e.expected : e.expectedValue.toString();
    return `${summarizeEntry(e)}: registered=${(r as {registered: string}).registered} expected=${expected}`;
  });
  throw new Error(
    `storage-root mismatch — refusing to overwrite. Investigate the existing registration:\n${lines.join('\n')}`,
  );
};

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

// ---------------- writers --------------------------------------------------------------

/**
 * Result of a submit-roots execution. May be `{txHash}` for a real send, or `{skipped}`
 * when every root was already registered correctly. Never both.
 */
export type SubmitRootsResult = ExecuteResult | {txHash?: undefined; skipped: string};

/**
 * Plan the batch: fetch proofs, read what's already in the warehouse, classify each entry.
 * Centralized so both `submitStorageRootsForBlock` and `executeSubmitStorageRoots` share
 * the exact same skip/mismatch logic.
 *
 * Returns the missing entries paired with their `BuiltEntry` metadata so error reporters
 * can name which root/slot would fail without re-deriving the mapping.
 */
const planBatch = async (
  ctx: ReadContext & {ethRpcUrls: string | string[]},
  config: VotingChainConfig,
  blockHash: Hex,
): Promise<{toSend: BuiltEntry[]; matched: number; total: number}> => {
  const entries = await buildStorageRootEntries(ctx.ethRpcUrls, config, blockHash, ctx.logger);
  const results = await inspectExisting(ctx, config, blockHash, entries);
  assertNoMismatches(results);

  const toSend = results.filter((r) => r.status === 'missing').map((r) => r.entry);
  const matched = results.filter((r) => r.status === 'match').length;
  ctx.logger.debug('submitStorageRoots: plan', {
    chain: config.name,
    matched,
    missing: toSend.length,
    total: entries.length,
  });
  return {toSend, matched, total: entries.length};
};

/**
 * Pre-flight: simulate `aggregate3` with `allowFailure: true` so per-call reverts surface
 * as `success: false` instead of bricking the simulation. If any entry would fail, throw
 * a rich error naming exactly which root/slot reverted — without burning gas on a doomed
 * tx and without the opaque "Multicall3: call failed" message that Multicall3 wraps inner
 * reverts in when `allowFailure: false`.
 */
const preflightSimulate = async (
  publicClient: PublicClient,
  account: Address,
  entries: BuiltEntry[],
): Promise<void> => {
  const result = await publicClient.simulateContract({
    address: MULTICALL3_ADDRESS,
    abi: multicall3Abi,
    functionName: 'aggregate3',
    args: [entries.map((e) => ({...e.call, allowFailure: true}))],
    account,
  });
  const perCall = result.result as ReadonlyArray<{success: boolean; returnData: Hex}>;
  const failed = perCall
    .map((r, i) => ({...r, entry: entries[i]!}))
    .filter((r) => !r.success);
  if (failed.length === 0) return;
  const detail = failed.map((f) => `${summarizeEntry(f.entry)}: ${decodeRevertReason(f.returnData)}`).join('; ');
  throw new Error(
    `pre-flight simulation: ${failed.length}/${entries.length} call(s) would revert — refusing to send. ` +
      `Failing: ${detail}. ` +
      `Common cause: "blockhash mismatch" means the block-header RLP we built doesn't hash to ` +
      `the given blockHash — usually a pre-merge block (we only encode post-merge headers). ` +
      `Other reverts likely indicate the L1 RPC's state proof is stale or doesn't match the requested block.`,
  );
};

/**
 * Decode a Solidity revert returnData blob to a human string. Handles the standard
 * `Error(string)` selector and falls back to the raw hex when the data is empty (bare revert)
 * or uses a custom-error selector we don't have an ABI for.
 */
const decodeRevertReason = (returnData: Hex): string => {
  if (!returnData || returnData === '0x') return 'revert (no reason)';
  try {
    const decoded = decodeErrorResult({
      abi: [
        {
          type: 'error',
          name: 'Error',
          inputs: [{name: 'message', type: 'string'}],
        },
      ],
      data: returnData,
    });
    return `"${(decoded.args as readonly [string])[0]}"`;
  } catch {
    return `revert (raw=${returnData.slice(0, 18)}…)`;
  }
};

/**
 * Low-level: submit storage roots for an arbitrary L1 block hash to a voting chain.
 * Use this when you don't have a proposal context — e.g., pre-warming roots for a custom
 * voting machine, or recovery flows. No state ready-check is performed.
 *
 * Skips the tx if every root is already registered with the matching value. Throws if any
 * registered value disagrees with what we'd submit (likely indicates corruption / a bad
 * upstream submission worth investigating).
 */
export const submitStorageRootsForBlock = async (
  ctx: WriteContext & {ethRpcUrls: string | string[]},
  args: {l1BlockHash: Hex; config: VotingChainConfig},
): Promise<SubmitRootsResult> => {
  ctx.logger.info('submitStorageRootsForBlock: planning', {
    blockHash: args.l1BlockHash,
    chain: args.config.name,
    dataWarehouse: args.config.dataWarehouse,
  });

  const {toSend, matched, total} = await planBatch(ctx, args.config, args.l1BlockHash);

  if (toSend.length === 0) {
    const reason = `all ${matched}/${total} roots already registered for ${args.l1BlockHash}`;
    ctx.logger.info('submitStorageRootsForBlock: skipped', {chain: args.config.name, reason});
    return {skipped: reason};
  }

  ctx.logger.debug('submitStorageRootsForBlock: pre-flight simulating', {
    sending: toSend.length,
    chain: args.config.name,
  });
  await preflightSimulate(ctx.publicClient, ctx.account, toSend);

  ctx.logger.info('submitStorageRootsForBlock: sending Multicall3.aggregate3', {
    sending: toSend.length,
    skipped: matched,
    chain: args.config.name,
  });

  const txHash = await sendAggregate3(ctx.walletClient, toSend.map((e) => e.call));
  ctx.logger.info('submitStorageRootsForBlock: submitted', {
    txHash,
    chain: args.config.name,
  });
  await notifyTxSuccess({
    publicClient: ctx.publicClient,
    chainId: ctx.chainId,
    chainName: args.config.name,
    action: 'submitStorageRoots',
    txHash,
    meta: {blockHash: args.l1BlockHash, sent: toSend.length, alreadyRegistered: matched},
    logger: ctx.logger,
  });
  return {txHash};
};

/**
 * Proposal-context wrapper: reads the proposal's snapshotBlockHash and reuses the same
 * inspect/skip/mismatch pipeline as `submitStorageRootsForBlock`.
 */
export const executeSubmitStorageRoots = async (
  ctx: WriteContext & {ethRpcUrls: string | string[]},
  args: {proposalId: bigint; l1ProposalBlockHash: Hex},
): Promise<SubmitRootsResult> => {
  const config = requireVotingChain(ctx.chainId);

  // Precheck: only the obvious blocker (no snapshot block hash on L1 yet). The
  // "already registered" case is handled by `planBatch` below — it inspects each
  // entry, skips matches, and throws on mismatch. Rejecting here would prevent
  // the integrity check from ever running.
  if (args.l1ProposalBlockHash === ZERO_HASH) {
    throw new Error(
      'submitStorageRoots precheck failed: no snapshot block hash yet (proposal not yet activated on L1)',
    );
  }

  ctx.logger.info('submitStorageRoots: planning', {
    proposalId: args.proposalId.toString(),
    blockHash: args.l1ProposalBlockHash,
    chain: config.name,
  });

  const {toSend, matched, total} = await planBatch(ctx, config, args.l1ProposalBlockHash);

  if (toSend.length === 0) {
    const reason = `all ${matched}/${total} roots already registered for ${args.l1ProposalBlockHash}`;
    ctx.logger.info('submitStorageRoots: skipped', {
      proposalId: args.proposalId.toString(),
      chain: config.name,
      reason,
    });
    return {skipped: reason};
  }

  ctx.logger.debug('submitStorageRoots: pre-flight simulating', {
    sending: toSend.length,
    chain: config.name,
  });
  await preflightSimulate(ctx.publicClient, ctx.account, toSend);

  ctx.logger.info('submitStorageRoots: sending Multicall3.aggregate3', {
    sending: toSend.length,
    skipped: matched,
    chain: config.name,
  });

  const txHash = await sendAggregate3(ctx.walletClient, toSend.map((e) => e.call));
  ctx.logger.info('submitStorageRoots: submitted', {
    proposalId: args.proposalId.toString(),
    txHash,
    chain: config.name,
  });
  await notifyTxSuccess({
    publicClient: ctx.publicClient,
    chainId: ctx.chainId,
    chainName: config.name,
    action: 'submitStorageRoots',
    txHash,
    meta: {
      proposalId: args.proposalId.toString(),
      blockHash: args.l1ProposalBlockHash,
      sent: toSend.length,
      alreadyRegistered: matched,
    },
    logger: ctx.logger,
  });
  return {txHash};
};
