/**
 * Payloads that should NEVER be executed by the robot.
 *
 * Add an entry here when a payload is known to revert on execution (bad target, broken
 * config, etc.) — instead of burning gas every 5 minutes retrying, we wait for the payload
 * to expire on-chain. Both the execution scan AND the CLI's `execute-payload` honour this
 * list (it's checked inside `checkExecutePayload`).
 *
 * To add an exception:
 *   1. Add a `{ chainId, payloadId, reason }` entry below.
 *   2. Redeploy: `tenderly actions deploy` (and/or rebuild the CLI bundle).
 *
 * The list is intentionally small and committed to the repo so every change goes through
 * code review. There's no on-chain "disabled" mapping like the old keepers had — emergency
 * mute is achieved by editing this file.
 */
export type DisabledPayload = {
  chainId: number;
  payloadId: number;
  reason: string;
};

export const DISABLED_PAYLOADS: DisabledPayload[] = [
  {
    chainId: 4326, // megaeth mainnet
    payloadId: 5,
    reason: 'megaeth payload that will not execute on-chain — waiting for expiry',
  },
    {
    chainId: 1, // 
    payloadId: 429,
    reason: 'bc robots were cancelled',
  },

];

export const isPayloadDisabled = (
  chainId: number,
  payloadId: bigint | number,
): DisabledPayload | undefined => {
  const idAsBigInt = BigInt(payloadId);
  return DISABLED_PAYLOADS.find((p) => p.chainId === chainId && BigInt(p.payloadId) === idAsBigInt);
};
