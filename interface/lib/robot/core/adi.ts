// Aave Delivery Infrastructure helpers — used to surface deep-links to the ADI envelope
// tracker (adi.onaave.com) from cross-chain-emitting actions (executeProposal on L1,
// closeAndSendVote on the voting chain).
//
// `EnvelopeRegistered(bytes32 indexed envelopeId, Envelope envelope)` is emitted by the
// CrossChainController on the SOURCE chain each time `forwardMessage` registers a new
// envelope. Source: ICrossChainForwarder.sol and EncodingUtils.sol (Envelope struct).
//
// One transaction can register multiple envelopes — a single `executeProposal` may forward
// payload messages to several execution chains, producing one envelope per destination.

import {
  GovernanceV3Arbitrum,
  GovernanceV3Avalanche,
  GovernanceV3Base,
  GovernanceV3BNB,
  GovernanceV3Celo,
  GovernanceV3Ethereum,
  GovernanceV3Gnosis,
  GovernanceV3Ink,
  GovernanceV3Linea,
  GovernanceV3Mantle,
  GovernanceV3MegaEth,
  GovernanceV3Metis,
  GovernanceV3Optimism,
  GovernanceV3Plasma,
  GovernanceV3Polygon,
  GovernanceV3Scroll,
  GovernanceV3Soneium,
  GovernanceV3Sonic,
  GovernanceV3XLayer,
  GovernanceV3ZkSync,
} from '@aave-dao/aave-address-book';
import {decodeEventLog, parseAbiItem, toEventSelector, type Address, type Hex} from 'viem';

/**
 * Canonical topic0 of `EnvelopeRegistered`. The Envelope struct is `(uint256, address,
 * address, uint256, uint256, bytes)` per `EncodingUtils.sol` — viem's `toEventSelector`
 * needs the full tuple form to compute the matching topic.
 */
export const ENVELOPE_REGISTERED_TOPIC = toEventSelector(
  'EnvelopeRegistered(bytes32,(uint256,address,address,uint256,uint256,bytes))',
);

/**
 * topic0 of `TransactionForwardingAttempted`. Per-envelope-per-adapter attempt log; the
 * `adapterSuccessful` boolean tells us whether that adapter forwarded successfully.
 *   event TransactionForwardingAttempted(
 *     bytes32 transactionId,
 *     bytes32 indexed envelopeId,
 *     bytes encodedTransaction,
 *     uint256 destinationChainId,
 *     address indexed bridgeAdapter,
 *     address destinationBridgeAdapter,
 *     bool indexed adapterSuccessful,
 *     bytes returnData
 *   );
 */
export const TRANSACTION_FORWARDING_ATTEMPTED_TOPIC = toEventSelector(
  'TransactionForwardingAttempted(bytes32,bytes32,bytes,uint256,address,address,bool,bytes)',
);

/**
 * Map chainId → CrossChainController address. Mirrors the chains list in
 * `core/chains.ts`. If a new chain is added there but not here, envelope deep-links
 * silently drop out of the notification (which is fine — the rest of the message still
 * fires per the resilience requirement).
 */
const CROSS_CHAIN_CONTROLLER_BY_CHAIN: Record<number, Address> = {
  [GovernanceV3Ethereum.CHAIN_ID]: GovernanceV3Ethereum.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Polygon.CHAIN_ID]: GovernanceV3Polygon.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Avalanche.CHAIN_ID]: GovernanceV3Avalanche.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Arbitrum.CHAIN_ID]: GovernanceV3Arbitrum.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Optimism.CHAIN_ID]: GovernanceV3Optimism.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Base.CHAIN_ID]: GovernanceV3Base.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3BNB.CHAIN_ID]: GovernanceV3BNB.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Gnosis.CHAIN_ID]: GovernanceV3Gnosis.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Metis.CHAIN_ID]: GovernanceV3Metis.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Scroll.CHAIN_ID]: GovernanceV3Scroll.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Celo.CHAIN_ID]: GovernanceV3Celo.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Linea.CHAIN_ID]: GovernanceV3Linea.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Mantle.CHAIN_ID]: GovernanceV3Mantle.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Ink.CHAIN_ID]: GovernanceV3Ink.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Plasma.CHAIN_ID]: GovernanceV3Plasma.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3MegaEth.CHAIN_ID]: GovernanceV3MegaEth.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Soneium.CHAIN_ID]: GovernanceV3Soneium.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3Sonic.CHAIN_ID]: GovernanceV3Sonic.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3XLayer.CHAIN_ID]: GovernanceV3XLayer.CROSS_CHAIN_CONTROLLER as Address,
  [GovernanceV3ZkSync.CHAIN_ID]: GovernanceV3ZkSync.CROSS_CHAIN_CONTROLLER as Address,
};

export const crossChainControllerFor = (chainId: number): Address | undefined =>
  CROSS_CHAIN_CONTROLLER_BY_CHAIN[chainId];

/** Minimal log shape — works for both viem logs and Tenderly's TransactionEvent.logs. */
type LogLike = {
  address: string;
  topics: readonly string[] | string[];
};

// ─── Forwarding-status extractor ─────────────────────────────────────────────

export type EnvelopeForwardStatus = {
  envelopeId: Hex;
  destinationChainId: number;
  attempts: number;
  succeeded: number;
  /** 'ok' iff every adapter for this destination succeeded; 'failed' otherwise. */
  status: 'ok' | 'failed';
};

type DataLogLike = LogLike & {data: string};

const TRANSACTION_FORWARDING_ATTEMPTED_ABI = parseAbiItem(
  'event TransactionForwardingAttempted(bytes32 transactionId, bytes32 indexed envelopeId, bytes encodedTransaction, uint256 destinationChainId, address indexed bridgeAdapter, address destinationBridgeAdapter, bool indexed adapterSuccessful, bytes returnData)',
);

/**
 * Group `TransactionForwardingAttempted` logs by envelopeId so the notification can show:
 *   envelope → mantle: <…>  ❌ 0/3 adapters succeeded
 * Returns `[]` on any total failure. Per-log decode failures are silently skipped so a
 * single malformed log doesn't poison the rest of the list.
 */
export const extractEnvelopeForwardStatuses = (
  logs: ReadonlyArray<LogLike>,
  crossChainController: Address | undefined,
): EnvelopeForwardStatus[] => {
  if (!crossChainController) return [];
  const ccc = crossChainController.toLowerCase();
  const expectedTopic = TRANSACTION_FORWARDING_ATTEMPTED_TOPIC.toLowerCase();
  const byEnvelope = new Map<Hex, {destinationChainId: number; attempts: number; succeeded: number}>();

  for (const log of logs) {
    try {
      if (!log || !log.address || !Array.isArray(log.topics)) continue;
      if (log.address.toLowerCase() !== ccc) continue;
      if ((log.topics[0] ?? '').toLowerCase() !== expectedTopic) continue;
      const dataLog = log as DataLogLike;
      if (typeof dataLog.data !== 'string') continue;

      const decoded = decodeEventLog({
        abi: [TRANSACTION_FORWARDING_ATTEMPTED_ABI],
        data: dataLog.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const args = decoded.args as {
        envelopeId: Hex;
        destinationChainId: bigint;
        adapterSuccessful: boolean;
      };

      const envelopeId = args.envelopeId;
      const destinationChainId = Number(args.destinationChainId);
      const success = args.adapterSuccessful === true;

      const existing = byEnvelope.get(envelopeId);
      if (existing) {
        existing.attempts += 1;
        if (success) existing.succeeded += 1;
      } else {
        byEnvelope.set(envelopeId, {
          destinationChainId,
          attempts: 1,
          succeeded: success ? 1 : 0,
        });
      }
    } catch {
      // Per-log decode failure: skip this entry.
    }
  }

  return Array.from(byEnvelope.entries()).map(([envelopeId, v]) => ({
    envelopeId,
    destinationChainId: v.destinationChainId,
    attempts: v.attempts,
    succeeded: v.succeeded,
    status: v.attempts > 0 && v.succeeded === v.attempts ? 'ok' : 'failed',
  }));
};

/**
 * Pull every `envelopeId` (topics[1]) from `EnvelopeRegistered` logs in this tx that
 * came from the given CrossChainController. Returns `[]` on any decode trouble —
 * callers wrap this in try/catch already, but the per-log guards mean a malformed log
 * doesn't poison the rest of the list.
 */
export const extractEnvelopeIds = (
  logs: ReadonlyArray<LogLike>,
  crossChainController: Address | undefined,
): Hex[] => {
  if (!crossChainController) return [];
  const ccc = crossChainController.toLowerCase();
  const out: Hex[] = [];
  for (const log of logs) {
    try {
      if (!log || !log.address || !Array.isArray(log.topics)) continue;
      if (log.address.toLowerCase() !== ccc) continue;
      if (log.topics[0]?.toLowerCase() !== ENVELOPE_REGISTERED_TOPIC.toLowerCase()) continue;
      const envelopeId = log.topics[1];
      if (typeof envelopeId === 'string' && /^0x[0-9a-fA-F]{64}$/.test(envelopeId)) {
        out.push(envelopeId as Hex);
      }
    } catch {
      // Defensive: one malformed log shouldn't drop all subsequent envelope IDs.
    }
  }
  return out;
};
