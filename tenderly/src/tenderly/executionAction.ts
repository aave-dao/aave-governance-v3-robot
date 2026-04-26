import type { ActionFn, Context, Event } from '@tenderly/actions';
import { EXECUTION_CHAINS } from '../core/chains';
import { runExecutionScan } from '../orchestration/executionScan';
import { setupChain } from './runtime';

const makeExecutionAction = (chainId: number): ActionFn => async (ctx: Context, _event: Event) => {
  const config = EXECUTION_CHAINS[chainId];
  if (!config) throw new Error(`chainId ${chainId} not in EXECUTION_CHAINS`);
  const target = await setupChain(ctx, chainId, config.name);
  target.logger.info('executionAction: scan start', { chain: config.name });
  const results = await runExecutionScan(target.write);
  target.logger.info('executionAction: scan done', {
    chain: config.name,
    actions: results.length,
    txs: results.filter((r) => r.txHash).length,
  });
};

export const execEthereum: ActionFn = makeExecutionAction(1);
export const execPolygon: ActionFn = makeExecutionAction(137);
export const execAvalanche: ActionFn = makeExecutionAction(43114);
export const execArbitrum: ActionFn = makeExecutionAction(42161);
export const execOptimism: ActionFn = makeExecutionAction(10);
export const execBase: ActionFn = makeExecutionAction(8453);
export const execBnb: ActionFn = makeExecutionAction(56);
export const execGnosis: ActionFn = makeExecutionAction(100);
export const execMetis: ActionFn = makeExecutionAction(1088);
export const execScroll: ActionFn = makeExecutionAction(534352);
export const execCelo: ActionFn = makeExecutionAction(42220);
export const execLinea: ActionFn = makeExecutionAction(59144);
export const execMantle: ActionFn = makeExecutionAction(5000);
export const execInk: ActionFn = makeExecutionAction(57073);
export const execPlasma: ActionFn = makeExecutionAction(9745);
export const execMegaeth: ActionFn = makeExecutionAction(6342);
export const execSoneium: ActionFn = makeExecutionAction(1868);
export const execSonic: ActionFn = makeExecutionAction(146);
export const execXlayer: ActionFn = makeExecutionAction(196);
export const execZksync: ActionFn = makeExecutionAction(324);
