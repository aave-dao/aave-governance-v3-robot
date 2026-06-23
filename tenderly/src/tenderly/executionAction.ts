import type {ActionFn, Context, Event} from '@tenderly/actions';
import {
  GovernanceV3Arbitrum,
  GovernanceV3Avalanche,
  GovernanceV3BNB,
  GovernanceV3Base,
  GovernanceV3Celo,
  GovernanceV3Ethereum,
  GovernanceV3Gnosis,
  GovernanceV3Ink,
  GovernanceV3Linea,
  GovernanceV3Mantle,
  GovernanceV3MegaEth,
  GovernanceV3Metis,
  GovernanceV3Monad,
  GovernanceV3Optimism,
  GovernanceV3Plasma,
  GovernanceV3Polygon,
  GovernanceV3Scroll,
  GovernanceV3Soneium,
  GovernanceV3Sonic,
  GovernanceV3XLayer,
  GovernanceV3ZkSync,
} from '@aave-dao/aave-address-book';
import {EXECUTION_CHAINS} from '../core/chains';
import {notifyError} from '../core/notify';
import {runExecutionScan} from '../orchestration/executionScan';
import {setupChain, tenderlyLogger} from './runtime';

/**
 * Per-chain action factory. Each Tenderly action handler scans one execution chain.
 *
 * We sourced chain IDs from the address book constants (NOT hardcoded numbers) — this is
 * deliberate: an earlier version hardcoded `6342` for MegaETH when the canonical id is
 * `4326`, and the deployed action crashed with "chainId 6342 not in EXECUTION_CHAINS"
 * for weeks. Tying every export to the address book ensures we never drift again.
 */
const makeExecutionAction =
  (chainId: number): ActionFn =>
  async (ctx: Context, _event: Event) => {
    const config = EXECUTION_CHAINS[chainId];
    if (!config) {
      throw new Error(
        `chainId ${chainId} not in EXECUTION_CHAINS — did the address book add a new chain?`,
      );
    }
    let logger;
    try {
      const target = await setupChain(ctx, chainId, config.name);
      logger = target.logger;
      logger.info('execAction: scan start', {chain: config.name});
      const results = await runExecutionScan(target.write);
      logger.info('execAction: scan done', {
        chain: config.name,
        actions: results.length,
        txs: results.filter((r) => r.txHash).length,
      });
    } catch (err) {
      await notifyError({
        source: 'execAction',
        error: err,
        chainId,
        chainName: config.name,
        logger,
      });
      throw err; // preserve Tenderly's own failure recording
    }
  };

export const execEthereum: ActionFn = makeExecutionAction(GovernanceV3Ethereum.CHAIN_ID);
export const execPolygon: ActionFn = makeExecutionAction(GovernanceV3Polygon.CHAIN_ID);
export const execAvalanche: ActionFn = makeExecutionAction(GovernanceV3Avalanche.CHAIN_ID);
export const execArbitrum: ActionFn = makeExecutionAction(GovernanceV3Arbitrum.CHAIN_ID);
export const execOptimism: ActionFn = makeExecutionAction(GovernanceV3Optimism.CHAIN_ID);
export const execBase: ActionFn = makeExecutionAction(GovernanceV3Base.CHAIN_ID);
export const execBnb: ActionFn = makeExecutionAction(GovernanceV3BNB.CHAIN_ID);
export const execGnosis: ActionFn = makeExecutionAction(GovernanceV3Gnosis.CHAIN_ID);
export const execMetis: ActionFn = makeExecutionAction(GovernanceV3Metis.CHAIN_ID);
export const execScroll: ActionFn = makeExecutionAction(GovernanceV3Scroll.CHAIN_ID);
export const execCelo: ActionFn = makeExecutionAction(GovernanceV3Celo.CHAIN_ID);
export const execLinea: ActionFn = makeExecutionAction(GovernanceV3Linea.CHAIN_ID);
export const execMantle: ActionFn = makeExecutionAction(GovernanceV3Mantle.CHAIN_ID);
export const execInk: ActionFn = makeExecutionAction(GovernanceV3Ink.CHAIN_ID);
export const execPlasma: ActionFn = makeExecutionAction(GovernanceV3Plasma.CHAIN_ID);
export const execMegaeth: ActionFn = makeExecutionAction(GovernanceV3MegaEth.CHAIN_ID);
export const execMonad: ActionFn = makeExecutionAction(GovernanceV3Monad.CHAIN_ID);
export const execSoneium: ActionFn = makeExecutionAction(GovernanceV3Soneium.CHAIN_ID);
export const execSonic: ActionFn = makeExecutionAction(GovernanceV3Sonic.CHAIN_ID);
export const execXlayer: ActionFn = makeExecutionAction(GovernanceV3XLayer.CHAIN_ID);
export const execZksync: ActionFn = makeExecutionAction(GovernanceV3ZkSync.CHAIN_ID);

/**
 * Consolidated fallback that scans every execution chain in sequence in a single Tenderly
 * Action. Kept around for accounts that hit the per-project action limit — see tenderly.yaml
 * for instructions to swap. Per-chain failure is isolated.
 */
export const executionAll: ActionFn = async (ctx: Context, _event: Event) => {
  const logger = tenderlyLogger().child({action: 'executionAll'});
  const ids = Object.keys(EXECUTION_CHAINS).map(Number);
  for (const chainId of ids) {
    const config = EXECUTION_CHAINS[chainId]!;
    try {
      const target = await setupChain(ctx, chainId, config.name);
      target.logger.info('executionAll: scan start', {chain: config.name});
      const results = await runExecutionScan(target.write);
      target.logger.info('executionAll: scan done', {
        chain: config.name,
        actions: results.length,
        txs: results.filter((r) => r.txHash).length,
      });
    } catch (err) {
      logger.error('executionAll: chain failed', {
        chain: config.name,
        chainId,
        error: err instanceof Error ? err.message : String(err),
      });
      await notifyError({
        source: 'executionAll',
        error: err,
        chainId,
        chainName: config.name,
        logger,
      });
    }
  }
};
