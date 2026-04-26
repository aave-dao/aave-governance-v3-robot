import type { ActionFn, Context, Event } from '@tenderly/actions';
import { VOTING_CHAINS, type VotingChainId } from '../core/chains';
import { runVotingScan } from '../orchestration/votingScan';
import { setupChain } from './runtime';

/**
 * Build a periodic Tenderly Action for a given voting chain. Each voting chain is its own
 * registered Tenderly action — see tenderly.yaml for the bindings.
 */
const makeVotingAction = (chainId: VotingChainId): ActionFn => async (ctx: Context, _event: Event) => {
  const config = VOTING_CHAINS[chainId]!;
  const target = await setupChain(ctx, chainId, config.name);
  target.logger.info('votingAction: scan start', { chain: config.name });
  const results = await runVotingScan({ ...target.write, ethRpcUrl: target.ethRpcUrl });
  target.logger.info('votingAction: scan done', {
    chain: config.name,
    actions: results.length,
    txs: results.filter((r) => r.txHash).length,
  });
};

export const votingEthereum: ActionFn = makeVotingAction(1);
export const votingPolygon: ActionFn = makeVotingAction(137);
export const votingAvalanche: ActionFn = makeVotingAction(43114);
