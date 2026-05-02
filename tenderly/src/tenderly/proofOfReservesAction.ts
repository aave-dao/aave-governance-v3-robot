import type {ActionFn, Context, Event} from '@tenderly/actions';
import {GovernanceV3Avalanche} from '@aave-dao/aave-address-book';
import {PROOF_OF_RESERVE_CHAINS} from '../core/chains';
import {notifyError} from '../core/notify';
import {runProofOfReservesScan} from '../orchestration/proofOfReservesScan';
import {setupChain, tenderlyLogger} from './runtime';

/**
 * Per-chain Proof-of-Reserves action factory. Today only Avalanche has PoR; new chains
 * are picked up automatically once added to PROOF_OF_RESERVE_CHAINS in core/chains.ts.
 *
 * Mirrors the on-chain Chainlink keeper at 0x7aE2930B50CFEbc99FE6DB16CE5B9C7D8d09332C.
 * Iterates every executor configured for the chain (V2 + V3 on Avalanche) — emergency
 * action is only triggered when the executor reports `!areAllReservesBacked && isEmergencyActionPossible`.
 */
const makeProofOfReservesAction =
  (chainId: number): ActionFn =>
  async (ctx: Context, _event: Event) => {
    const config = PROOF_OF_RESERVE_CHAINS[chainId];
    if (!config) {
      throw new Error(
        `chainId ${chainId} not in PROOF_OF_RESERVE_CHAINS — ` +
          `add it to core/chains.ts to monitor it`,
      );
    }
    let logger;
    try {
      const target = await setupChain(ctx, chainId, config.name);
      logger = target.logger;
      logger.info('proofOfReservesAction: scan start', {
        chain: config.name,
        executors: config.executors.length,
      });
      const results = await runProofOfReservesScan(target.write);
      logger.info('proofOfReservesAction: scan done', {
        chain: config.name,
        actions: results.length,
        txs: results.filter((r) => r.txHash).length,
      });
    } catch (err) {
      await notifyError({
        source: 'proofOfReservesAction',
        error: err,
        chainId,
        chainName: config.name,
        logger,
      });
      throw err; // preserve Tenderly's own failure recording
    }
  };

export const proofOfReservesAvalanche: ActionFn = makeProofOfReservesAction(
  GovernanceV3Avalanche.CHAIN_ID,
);

/**
 * Consolidated fallback that scans every PoR-enabled chain in sequence, used if the
 * per-project Tenderly action limit is hit. Per-chain failure is isolated.
 */
export const proofOfReservesAll: ActionFn = async (ctx: Context, _event: Event) => {
  const logger = tenderlyLogger().child({action: 'proofOfReservesAll'});
  const ids = Object.keys(PROOF_OF_RESERVE_CHAINS).map(Number);
  for (const chainId of ids) {
    const config = PROOF_OF_RESERVE_CHAINS[chainId]!;
    try {
      const target = await setupChain(ctx, chainId, config.name);
      target.logger.info('proofOfReservesAll: scan start', {chain: config.name});
      const results = await runProofOfReservesScan(target.write);
      target.logger.info('proofOfReservesAll: scan done', {
        chain: config.name,
        actions: results.length,
        txs: results.filter((r) => r.txHash).length,
      });
    } catch (err) {
      logger.error('proofOfReservesAll: chain failed', {
        chain: config.name,
        chainId,
        error: err instanceof Error ? err.message : String(err),
      });
      await notifyError({
        source: 'proofOfReservesAll',
        error: err,
        chainId,
        chainName: config.name,
        logger,
      });
    }
  }
};
