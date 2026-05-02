import type {ActionFn, Context, Event, TransactionEvent} from '@tenderly/actions';
import {decodeEventLog, toEventSelector, type Hex} from 'viem';
import {governanceAbi} from '../core/abis';
import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import {findVotingChainByPortal, GOVERNANCE_CHAIN_ID} from '../core/chains';
import {executeSubmitStorageRoots} from '../core/actions';
import {notifyError} from '../core/notify';
import {setupChain} from './runtime';

// Computed once at module load: keccak256("VotingActivated(uint256,bytes32,uint24)")
const VOTING_ACTIVATED_TOPIC0 = toEventSelector(
  'VotingActivated(uint256 indexed proposalId, bytes32 indexed snapshotBlockHash, uint24 votingDuration)',
);

const GOVERNANCE_ADDRESS = (GovernanceV3Ethereum.GOVERNANCE as string).toLowerCase();

/**
 * Triggered by a transaction filter on the L1 Governance contract whenever it emits
 * `VotingActivated`. For each matching log, fetch storage proofs from L1 and submit
 * them to the appropriate voting chain's DataWarehouse.
 */
export const votingActivatedListener: ActionFn = async (ctx: Context, event: Event) => {
  const tx = event as TransactionEvent;
  let logger;
  try {
    const govSetup = await setupChain(ctx, GOVERNANCE_CHAIN_ID, 'ethereum');
    logger = govSetup.logger;

    const matching = tx.logs.filter(
      (l) =>
        l.address.toLowerCase() === GOVERNANCE_ADDRESS && l.topics[0] === VOTING_ACTIVATED_TOPIC0,
    );
    logger.info('votingActivatedListener: tx received', {tx: tx.hash, matching: matching.length});

    for (const log of matching) {
      let proposalId: bigint;
      let snapshotBlockHash: Hex;
      try {
        const decoded = decodeEventLog({
          abi: governanceAbi,
          eventName: 'VotingActivated',
          data: log.data as Hex,
          topics: log.topics as [Hex, ...Hex[]],
        });
        proposalId = decoded.args.proposalId;
        snapshotBlockHash = decoded.args.snapshotBlockHash;
      } catch (err) {
        logger.error('votingActivatedListener: decode failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        await notifyError({source: 'votingActivatedListener (decode)', error: err, logger});
        continue;
      }

      const proposal = await govSetup.read.publicClient.readContract({
        address: GovernanceV3Ethereum.GOVERNANCE as `0x${string}`,
        abi: governanceAbi,
        functionName: 'getProposal',
        args: [proposalId],
      });
      const votingChain = findVotingChainByPortal(proposal.votingPortal);
      if (!votingChain) {
        logger.warn('votingActivatedListener: unknown voting portal', {
          proposalId: proposalId.toString(),
          portal: proposal.votingPortal,
        });
        continue;
      }

      const target = await setupChain(ctx, votingChain.chainId, votingChain.name);
      try {
        const r = await executeSubmitStorageRoots(
          {...target.write, ethRpcUrls: govSetup.ethRpcUrls},
          {proposalId, l1ProposalBlockHash: snapshotBlockHash},
        );
        if (r.txHash) {
          logger.info('votingActivatedListener: roots submitted', {
            proposalId: proposalId.toString(),
            chain: votingChain.name,
            txHash: r.txHash,
          });
        } else {
          logger.info('votingActivatedListener: skipped (already registered)', {
            proposalId: proposalId.toString(),
            chain: votingChain.name,
            reason: r.skipped,
          });
        }
      } catch (err) {
        logger.error('votingActivatedListener: submit failed', {
          proposalId: proposalId.toString(),
          chain: votingChain.name,
          error: err instanceof Error ? err.message : String(err),
        });
        await notifyError({
          source: 'votingActivatedListener (submit)',
          error: err,
          chainId: votingChain.chainId,
          chainName: votingChain.name,
          meta: {proposalId: proposalId.toString()},
          logger,
        });
      }
    }
  } catch (err) {
    // Outer catch — notifyError dedupes via a marker on the error, so if an inner catch
    // already notified, this is a no-op for the channel POST.
    await notifyError({source: 'votingActivatedListener', error: err, logger});
    throw err;
  }
};
