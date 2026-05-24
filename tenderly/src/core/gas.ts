// Gas-estimation helper with safety margin.
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
// Fix: estimate, then multiply by `(100 + margin)/100`. Default margin is 50% — overshoot
// is essentially free (unused gas isn't charged) but undershoot causes silent per-adapter
// drop-outs.

import type {Abi, Account, Address, PublicClient} from 'viem';

/** Default safety margin above `estimateGas`, in percent. 50% = multiply estimate by 1.5. */
export const DEFAULT_GAS_MARGIN_PCT = 50;

export type EstimateGasParams = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  account: Account | Address;
  value?: bigint;
};

/**
 * Run `estimateContractGas` and add a safety margin. Use the returned bigint as the
 * `gas` field of `writeContract` so we override viem's default (no-margin) flow.
 *
 * Caller-tunable margin via `marginPct` — defaults to `DEFAULT_GAS_MARGIN_PCT`.
 */
export const estimateGasWithMargin = async (
  publicClient: PublicClient,
  request: EstimateGasParams,
  marginPct: number = DEFAULT_GAS_MARGIN_PCT,
): Promise<bigint> => {
  // viem's PublicClient.estimateContractGas signature is heavily generic; we keep our
  // helper's shape narrow and cast at the call boundary. Behaviour is identical to
  // viem's internal estimate during writeContract.
  const estimated = (await publicClient.estimateContractGas(request as never)) as bigint;
  // Ceil-divide so we never UNDER-estimate by 1 wei of gas due to integer rounding.
  return (estimated * BigInt(100 + marginPct) + 99n) / 100n;
};
