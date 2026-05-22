// Tenderly Web3 Action handlers for proposal-lifecycle events. Each exported ActionFn is
// wired to a specific contract via tenderly.yaml; the body iterates the tx logs,
// decodes any lifecycle event we know about, enriches with IPFS title/author + dashboard
// + ADI envelope links, and posts to Slack/TG.
//
// Sender-match dedupe: when our own signer EOA fired the tx, the calling action handler
// (activateVoting / executeProposal / createVote / closeAndSendVote / cancelProposal)
// has already posted a `notifyTxSuccess` message for that tx. Re-notifying from the
// lifecycle listener would duplicate. Short-circuit when tx.from matches our signer.

import type {ActionFn, Context, Event, TransactionEvent} from '@tenderly/actions';
import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import {decodeEventLog, type Address, type Hex} from 'viem';
import {GOVERNANCE_CHAIN_ID, VOTING_CHAINS} from '../core/chains';
import {crossChainControllerFor, extractEnvelopeIds} from '../core/adi';
import {
  ENVELOPE_EMITTING_EVENTS,
  L1_LIFECYCLE_EVENTS,
  LIFECYCLE_EVENTS,
  LIFECYCLE_EVENT_BY_TOPIC,
  VM_LIFECYCLE_EVENTS,
  type LifecycleEventName,
} from '../core/lifecycle-events';
import type {Logger} from '../core/logger';
import {notifyError} from '../core/notify';
import {notifyProposalEvent} from '../core/notifyEvent';
import {setupChain} from './runtime';

type ContractAddressGetter = () => Address;

type ListenerSpec = {
  contractAddress: ContractAddressGetter;
  allowedEvents: ReadonlySet<LifecycleEventName>;
  chainId: number;
  chainName: string;
};

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

const makeContractEventListener = (spec: ListenerSpec): ActionFn => {
  return async (ctx: Context, event: Event) => {
    const tx = event as TransactionEvent;
    let logger: Logger | undefined;
    try {
      // L1 client is always needed (for IPFS lookup via getProposal); local client is needed
      // for our-signer comparison + logger context. Same chain → same setup.
      const govSetup = await setupChain(ctx, GOVERNANCE_CHAIN_ID, 'ethereum');
      const localSetup =
        spec.chainId === GOVERNANCE_CHAIN_ID
          ? govSetup
          : await setupChain(ctx, spec.chainId, spec.chainName);
      logger = localSetup.logger;

      // Skip when our signer fired this tx — own-action handler already notified.
      const ourSigner = localSetup.write.account.toLowerCase();
      const txFrom = (tx.from ?? '').toLowerCase();
      if (txFrom && txFrom === ourSigner) {
        logger.info('lifecycle-listener: skipping (own signer fired this tx)', {
          tx: tx.hash,
          signer: ourSigner,
        });
        return;
      }

      const contract = spec.contractAddress().toLowerCase();
      // Cache envelope IDs once per tx — multiple matching logs share the same set.
      let envelopeIds: Hex[] | null = null;
      const getEnvelopeIds = (): Hex[] => {
        if (envelopeIds !== null) return envelopeIds;
        try {
          envelopeIds = extractEnvelopeIds(tx.logs, crossChainControllerFor(spec.chainId));
        } catch (err) {
          logger?.warn('lifecycle-listener: envelope extraction failed', {
            error: err instanceof Error ? err.message : String(err),
          });
          envelopeIds = [];
        }
        return envelopeIds;
      };

      let matched = 0;
      for (const log of tx.logs) {
        if (!log || typeof log.address !== 'string' || !Array.isArray(log.topics)) continue;
        if (log.address.toLowerCase() !== contract) continue;
        const topic0 = log.topics[0]?.toLowerCase();
        if (!topic0) continue;
        const eventInfo = LIFECYCLE_EVENT_BY_TOPIC[topic0];
        if (!eventInfo || !spec.allowedEvents.has(eventInfo.name)) continue;

        let proposalId: bigint;
        let extraFields: Record<string, string> | undefined;
        try {
          const decoded = decodeEventLog({
            abi: [eventInfo.abi],
            data: log.data as Hex,
            topics: log.topics as [Hex, ...Hex[]],
          });
          // All lifecycle events we listen to expose `proposalId` as the first indexed arg.
          proposalId = (decoded.args as {proposalId: bigint}).proposalId;
          extraFields = buildExtraFields(eventInfo.name, decoded.args);
        } catch (err) {
          logger?.warn('lifecycle-listener: decode failed', {
            event: eventInfo.name,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        const envelopes = ENVELOPE_EMITTING_EVENTS.has(eventInfo.name) ? getEnvelopeIds() : [];

        await notifyProposalEvent({
          proposalId,
          event: eventInfo.name,
          chainId: spec.chainId,
          chainName: spec.chainName,
          txHash: tx.hash as Hex,
          l1Client: govSetup.read.publicClient,
          envelopeIds: envelopes,
          extraFields,
          logger,
        });
        matched += 1;
      }
      logger.info('lifecycle-listener: tx processed', {tx: tx.hash, matched});
    } catch (err) {
      // Outer catch — notifyError dedupes via the symbol marker so we don't double-notify
      // if an inner branch already routed through it.
      await notifyError({source: 'lifecycle-listener', error: err, logger});
      throw err; // preserve Tenderly's own failure recording
    }
  };
};

/**
 * Per-event human-friendly extra fields. Decoded values are formatted to strings here.
 * Anything that throws drops to undefined — the notification still fires without the
 * extra fields.
 */
const buildExtraFields = (
  name: LifecycleEventName,
  args: unknown,
): Record<string, string> | undefined => {
  try {
    const a = args as Record<string, unknown>;
    if (name === 'ProposalQueued') {
      return {
        votesFor: String(a.votesFor),
        votesAgainst: String(a.votesAgainst),
      };
    }
    if (name === 'ProposalResultsSent') {
      return {
        forVotes: String(a.forVotes),
        againstVotes: String(a.againstVotes),
      };
    }
    if (name === 'VotingActivated') {
      return {
        snapshotBlockHash: String(a.snapshotBlockHash),
        votingDuration: String(a.votingDuration),
      };
    }
    if (name === 'ProposalVoteStarted') {
      return {
        startTime: String(a.startTime),
        endTime: String(a.endTime),
      };
    }
    if (name === 'ProposalCreated') {
      const ipfs = a.ipfsHash as string | undefined;
      return {
        creator: String(a.creator),
        accessLevel: String(a.accessLevel),
        ...(ipfs && ipfs !== ZERO_HASH ? {ipfsHash: ipfs} : {}),
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
};

// ─── Exported ActionFns (wired in tenderly.yaml) ──────────────────────────────

export const l1GovernanceEventListener: ActionFn = makeContractEventListener({
  contractAddress: () => GovernanceV3Ethereum.GOVERNANCE as Address,
  allowedEvents: new Set(L1_LIFECYCLE_EVENTS),
  chainId: GOVERNANCE_CHAIN_ID,
  chainName: 'ethereum',
});

export const votingMachineEthListener: ActionFn = makeContractEventListener({
  contractAddress: () => VOTING_CHAINS[1].votingMachine,
  allowedEvents: new Set(VM_LIFECYCLE_EVENTS),
  chainId: 1,
  chainName: 'ethereum',
});

export const votingMachinePolygonListener: ActionFn = makeContractEventListener({
  contractAddress: () => VOTING_CHAINS[137].votingMachine,
  allowedEvents: new Set(VM_LIFECYCLE_EVENTS),
  chainId: 137,
  chainName: 'polygon',
});

export const votingMachineAvalancheListener: ActionFn = makeContractEventListener({
  contractAddress: () => VOTING_CHAINS[43114].votingMachine,
  allowedEvents: new Set(VM_LIFECYCLE_EVENTS),
  chainId: 43114,
  chainName: 'avalanche',
});

// Suppress "imported but unused" for re-exported types when this file is imported by index.ts
void LIFECYCLE_EVENTS;
