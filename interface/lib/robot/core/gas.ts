// Gas-estimation helper with safety margin AND block-gas-limit cap.
//
// Default viem.writeContract flow: call `eth_estimateGas` once and use the returned value
// as-is. That value is the MINIMUM gas needed for the tx to succeed at the simulated
// state. In practice that fails when:
//
//   - State shifts between simulation and broadcast (another tx lands first, refund
//     accounting differs, etc.).
//   - The contract executes sub-calls under the 63/64 rule. A parent tx with "just
//     enough" gas leaves at most 63/64 of its remaining gas for each sub-call. For
//     contracts like `executeProposal` on the L1 GovernanceCore, which fans out to N
//     bridge adapters via try/catch (per-adapter OOG is absorbed into
//     `adapterSuccessful: false` rather than reverting), a single adapter running out
//     of gas is INVISIBLE in the receipt's top-level `status: success`. This is exactly
//     what bit proposal #487's mantle envelope.
//
// Fix: estimate, multiply by `(100 + margin)/100`, then cap at `cap%` of the latest
// block's gas limit. The cap matters because a tx whose gas field exceeds the block
// limit is rejected by the RPC ("intrinsic gas too high") — naive multiplication can
// blow past the limit on chains with tight blocks (mainnet ~36M, some L2s 30M) or for
// payloads that genuinely use a large fraction of the block. The margin is reserved
// when there's room; when there isn't, we trade margin for fitting in the block.

import type {Abi, Account, Address, PublicClient} from 'viem';

/** Default safety margin above `estimateGas`, in percent. 50% = multiply estimate by 1.5. */
export const DEFAULT_GAS_MARGIN_PCT = 50;

/**
 * Per-chain protocol-level cap on the gas a SINGLE transaction may use. On some chains
 * this is lower than `block.gasLimit` (so the block limit alone isn't a tight enough
 * upper bound). Each entry has a primary-source citation in its comment.
 *
 * Chains absent from this table fall back to `block.gasLimit` (the network's only
 * enforced per-tx ceiling — txs must fit in a block). Add an entry as new chains roll
 * out their own protocol-level per-tx caps.
 *
 * Notable chains DELIBERATELY OMITTED (no documented per-tx cap below block gasLimit
 * as of mid-2026):
 *   - Avalanche, BNB Chain, Celo, Sonic, X Layer, Plasma, Mantle.
 *   - Optimism, Ink, Soneium — Karst hardfork (EIP-7825 adoption) scheduled 2026-07-08;
 *     add 16_777_216n when live.
 */
const MAX_PER_TX_GAS: Record<number, bigint> = {
  // Ethereum mainnet — EIP-7825 (Fusaka, 2025): 2^24 = 16,777,216.
  // https://eips.ethereum.org/EIPS/eip-7825
  1: 16_777_216n,
  // Gnosis Chain — Fusaka EIP-7825, scheduled epoch 1714688 (2026-04-14).
  // https://blog.validategnosis.com/p/gnosis-chain-fusaka-hard-fork-announcement
  100: 16_777_216n,
  // Polygon PoS — Madhugiri hardfork (Gigagas Phase 3, Dec 2025), live.
  // Cross-referenced in EIP-8123: "Arbitrum and Polygon both use 32,000,000".
  137: 32_000_000n,
  // Monad — protocol-enforced per-tx cap (block gasLimit is 200M, this is the
  // tighter ceiling).
  // https://docs.monad.xyz/developer-essentials/gas-pricing
  143: 30_000_000n,
  // ZKsync Era — bootloader-enforced MAX_TX_GAS for computation; no traditional
  // block.gasLimit on ZKsync so this is the practical bound.
  // https://docs.zksync.io/zksync-protocol/era-vm/contracts/bootloader
  324: 80_000_000n,
  // MegaETH — protocol-level compute gas limit (block limit is 10B, this is far tighter).
  // https://docs.megaeth.com/spec
  4326: 200_000_000n,
  // Base — Azul hardfork EIP-7825 (live 2026-05-28).
  // https://docs.base.org/base-chain/network-information/block-building
  8453: 16_777_216n,
  // Arbitrum One — ArbOS 51 ("Dia") MaxTxGasLimit, live 2026-01-08. Configurable via
  // ArbOwner precompile but 32M is the shipping value.
  // https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos51
  42161: 32_000_000n,
};

export type EstimateGasParams = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  account: Account | Address;
  value?: bigint;
};

export type EstimateGasOptions = {
  /** Safety margin above estimate, in percent. Defaults to `DEFAULT_GAS_MARGIN_PCT` (50). */
  marginPct?: number;
};

/**
 * Read the latest block's `gasLimit`. Best-effort: returns `null` on any RPC failure so
 * the cap is skipped rather than blocking the tx send. We don't cache because:
 *   - Block limits change rarely, but proposers can adjust them ±1/1024 per block; using
 *     the latest value tracks any drift.
 *   - One `eth_getBlockByNumber` per writeContract is negligible vs. the actual tx send.
 *   - Avoids stale-cache bugs across process invocations in Tenderly Actions.
 */
const fetchBlockGasLimit = async (publicClient: PublicClient): Promise<bigint | null> => {
  try {
    const block = await publicClient.getBlock({blockTag: 'latest'});
    return block.gasLimit > 0n ? block.gasLimit : null;
  } catch {
    return null;
  }
};

/**
 * Run `estimateContractGas`, add a safety margin, then cap at the network's per-tx limit.
 *
 * Cap resolution (in order):
 *   1. `MAX_PER_TX_GAS[chainId]` if the chain has a known protocol-level per-tx cap (e.g.
 *      Ethereum's 2^24 via EIP-7825).
 *   2. Otherwise `block.gasLimit` — the only network-enforced ceiling for any single tx
 *      on chains without a separate per-tx cap.
 *   3. If `getBlock` fails and no per-chain cap is set, no cap is applied (better to try
 *      the tx than refuse to send because of an RPC blip).
 *
 * Tunable margin via `EstimateGasOptions.marginPct`.
 */
export const estimateGasWithMargin = async (
  publicClient: PublicClient,
  request: EstimateGasParams,
  options: EstimateGasOptions | number = {},
): Promise<bigint> => {
  // Back-compat: callers used to pass `marginPct` as the third positional arg (number).
  // Normalize either shape.
  const opts: EstimateGasOptions = typeof options === 'number' ? {marginPct: options} : options;
  const marginPct = opts.marginPct ?? DEFAULT_GAS_MARGIN_PCT;

  // Run estimate + block fetch in parallel — both are independent reads.
  const [estimated, blockGasLimit] = await Promise.all([
    publicClient.estimateContractGas(request as never) as Promise<bigint>,
    fetchBlockGasLimit(publicClient),
  ]);

  // Ceil-divide so we never UNDER-estimate by 1 wei of gas due to integer rounding.
  const withMargin = (estimated * BigInt(100 + marginPct) + 99n) / 100n;

  // Per-chain protocol cap wins when set; otherwise fall back to block.gasLimit.
  const chainId = publicClient.chain?.id;
  const perTxCap = chainId !== undefined ? MAX_PER_TX_GAS[chainId] : undefined;
  const cap = perTxCap ?? blockGasLimit ?? undefined;

  return cap !== undefined && withMargin > cap ? cap : withMargin;
};
