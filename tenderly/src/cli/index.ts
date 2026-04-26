#!/usr/bin/env bun
import {Command} from 'commander';
import {
  GOVERNANCE_CHAIN_ID,
  VOTING_CHAINS,
  EXECUTION_CHAINS,
  findVotingChainByPortal,
  type VotingChainId,
} from '../core/chains';
import {
  activateVotingAction,
  cancelProposalAction,
  closeAndSendVoteAction,
  createVoteAction,
  executePayloadAction,
  executeProposalAction,
  executeSubmitStorageRoots,
  submitStorageRootsForBlock,
} from '../core/actions';
import {createLogger} from '../core/logger';
import {colorFormatter} from './logFormat';
import {inspectProposal, type InspectorConfig} from '../orchestration/proposalInspector';
import {formatInspectorReport} from './format';
import {decodeProposal, formatDecodeResult} from './decode';
import {runGovernanceScan} from '../orchestration/governanceScan';
import {runVotingScan} from '../orchestration/votingScan';
import {runExecutionScan} from '../orchestration/executionScan';
import {buildInspectorClients, ethRpcUrl, makeWriteContext} from './clientFactory';
import {loadEnv, type Env} from './env';
import type {Logger} from '../core/logger';
import {governanceAbi, votingMachineAbi} from '../core/abis';
import {jsonRpcCall} from '../core/rpc';
import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import type {Address} from 'viem';

const program = new Command();
program
  .name('aave-gov-robot')
  .description('Aave Governance V3 robot (Tenderly + CLI)')
  .version('0.1.0')
  // Counted verbosity flag — `-v` debug, `-vv` trace, `-vvv` trace (capped). Default is `info`.
  // Shows the same way as e.g. ssh: each repetition increments the counter.
  .option(
    '-v, --verbose',
    'increase verbosity. -v=debug, -vv=trace. Without it, falls back to LOG_LEVEL env var (default info).',
    (_value: string, prev: number) => prev + 1,
    0,
  );

const resolveLogLevel = (env: Env): import('../core/logger').LogLevel => {
  const verbose = (program.opts().verbose as number) || 0;
  if (verbose >= 2) return 'trace';
  if (verbose === 1) return 'debug';
  return env.LOG_LEVEL;
};

const resolveVotingChainByName = (name: string): VotingChainId => {
  const lower = name.toLowerCase();
  for (const id of Object.keys(VOTING_CHAINS).map(Number) as VotingChainId[]) {
    if (VOTING_CHAINS[id]!.name === lower) return id;
  }
  throw new Error(`unknown voting chain: ${name}`);
};

const resolveExecutionChainByName = (name: string): number => {
  const lower = name.toLowerCase();
  for (const id of Object.keys(EXECUTION_CHAINS).map(Number)) {
    if (EXECUTION_CHAINS[id]!.name === lower) return id;
  }
  throw new Error(`unknown execution chain: ${name}`);
};

/**
 * For voting-chain commands (submit-roots, create-vote, close-vote): the proposalId fully
 * determines the target chain via its votingPortal on L1. `--chain` only acts as an override
 * if the user wants to force a specific one (rare).
 */
const resolveVotingChainForProposal = async (
  env: Env,
  logger: Logger,
  proposalId: bigint,
  override?: string,
): Promise<{chainId: VotingChainId; chainName: string; snapshotBlockHash: `0x${string}`}> => {
  if (override) {
    const chainId = resolveVotingChainByName(override);
    // Still read the proposal to surface the snapshot block hash.
    const govCtx = makeWriteContext(env, GOVERNANCE_CHAIN_ID, logger, 'ethereum');
    const proposal = await govCtx.publicClient.readContract({
      address: GovernanceV3Ethereum.GOVERNANCE as Address,
      abi: governanceAbi,
      functionName: 'getProposal',
      args: [proposalId],
    });
    return {
      chainId,
      chainName: VOTING_CHAINS[chainId]!.name,
      snapshotBlockHash: proposal.snapshotBlockHash as `0x${string}`,
    };
  }
  const govCtx = makeWriteContext(env, GOVERNANCE_CHAIN_ID, logger, 'ethereum');
  const proposal = await govCtx.publicClient.readContract({
    address: GovernanceV3Ethereum.GOVERNANCE as Address,
    abi: governanceAbi,
    functionName: 'getProposal',
    args: [proposalId],
  });
  const config = findVotingChainByPortal(proposal.votingPortal);
  if (!config) {
    throw new Error(
      `proposal ${proposalId} uses unknown voting portal ${proposal.votingPortal}; pass --chain <name> to override`,
    );
  }
  return {
    chainId: config.chainId as VotingChainId,
    chainName: config.name,
    snapshotBlockHash: proposal.snapshotBlockHash as `0x${string}`,
  };
};

// -------- inspect --------
program
  .command('inspect <proposalId>')
  .description('Walk a proposal through every lifecycle stage and report what is missing')
  .option('--no-metadata', 'skip the IPFS title/author fetch')
  .action(async (idStr: string, opts: {metadata: boolean}) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const proposalId = BigInt(idStr);
    const {govPublic, votingClients, executionClients} = buildInspectorClients(env);
    const config: InspectorConfig = {
      l1Public: govPublic,
      votingClients,
      executionClients,
      logger,
      fetchMetadata: opts.metadata !== false,
    };
    const report = await inspectProposal(config, proposalId);
    process.stdout.write(formatInspectorReport(report) + '\n');
  });

// -------- decode --------
program
  .command('decode <proposalId>')
  .description(
    'Fetch + decode a proposal: title, author, discussions, payloads, optionally full body',
  )
  .option('--full', 'print the full proposal body from IPFS')
  .option('--no-metadata', 'skip the IPFS fetch (only print on-chain fields)')
  .action(async (idStr: string, opts: {full?: boolean; metadata: boolean}) => {
    loadEnv();
    const result = await decodeProposal(BigInt(idStr), {fetchMetadata: opts.metadata !== false});
    process.stdout.write(formatDecodeResult(result, {full: opts.full}) + '\n');
  });

// -------- per-action commands --------
program
  .command('activate <proposalId>')
  .description('activateVoting on the governance chain')
  .action(async (idStr: string) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const ctx = makeWriteContext(env, GOVERNANCE_CHAIN_ID, logger, 'ethereum');
    const {txHash} = await activateVotingAction.execute(ctx, BigInt(idStr));
    logger.info('activate: done', {txHash});
  });

program
  .command('execute <proposalId>')
  .description('executeProposal on the governance chain')
  .action(async (idStr: string) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const ctx = makeWriteContext(env, GOVERNANCE_CHAIN_ID, logger, 'ethereum');
    const {txHash} = await executeProposalAction.execute(ctx, BigInt(idStr));
    logger.info('execute: done', {txHash});
  });

program
  .command('cancel <proposalId>')
  .description('cancelProposal on the governance chain')
  .action(async (idStr: string) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const ctx = makeWriteContext(env, GOVERNANCE_CHAIN_ID, logger, 'ethereum');
    const {txHash} = await cancelProposalAction.execute(ctx, BigInt(idStr));
    logger.info('cancel: done', {txHash});
  });

program
  .command('submit-roots <proposalId>')
  .description(
    'Submit storage roots to the voting chain DataWarehouse (chain auto-resolved from proposal)',
  )
  .option('--chain <name>', 'override voting chain (ethereum|polygon|avalanche)')
  .action(async (idStr: string, opts: {chain?: string}) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const proposalId = BigInt(idStr);
    const {chainId, chainName, snapshotBlockHash} = await resolveVotingChainForProposal(
      env,
      logger,
      proposalId,
      opts.chain,
    );
    logger.info('submit-roots: resolved chain', {chain: chainName, chainId});
    const ctx = makeWriteContext(env, chainId, logger, chainName);
    const {txHash} = await executeSubmitStorageRoots(
      {...ctx, ethRpcUrl: ethRpcUrl(env)},
      {proposalId, l1ProposalBlockHash: snapshotBlockHash},
    );
    logger.info('submit-roots: done', {txHash});
  });

program
  .command('submit-roots-for-block <block>')
  .description(
    'Submit storage roots for an L1 block to a voting chain. <block> accepts a 32-byte hash ' +
      'or a block number (decimal or 0xHEX) — numbers are resolved to a hash via eth_getBlockByNumber. ' +
      'Default chain is avalanche; --voting-machine <addr> overrides the DataWarehouse target.',
  )
  .option('--chain <name>', 'voting chain (ethereum|polygon|avalanche)', 'avalanche')
  .option(
    '--voting-machine <addr>',
    'custom voting machine address (its DATA_WAREHOUSE() is queried)',
  )
  .action(async (block: string, opts: {chain: string; votingMachine?: string}) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);

    // Resolve a 32-byte block hash. If <block> is already a hash use it; else treat as number.
    let blockHash: `0x${string}`;
    if (/^0x[0-9a-fA-F]{64}$/.test(block)) {
      blockHash = block as `0x${string}`;
    } else {
      const numHex = (
        block.startsWith('0x') ? block : `0x${BigInt(block).toString(16)}`
      ) as `0x${string}`;
      logger.debug('submit-roots-for-block: resolving hash from number', {numHex});
      const blockData = await jsonRpcCall<{hash: `0x${string}`} | null>(
        ethRpcUrl(env),
        'eth_getBlockByNumber',
        [numHex, false],
      );
      if (!blockData || !blockData.hash) {
        throw new Error(`block ${block} not found on L1`);
      }
      blockHash = blockData.hash;
      logger.info('submit-roots-for-block: resolved', {number: block, hash: blockHash});
    }

    const chainId = resolveVotingChainByName(opts.chain);
    const defaults = VOTING_CHAINS[chainId]!;
    let config = defaults;

    if (opts.votingMachine) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(opts.votingMachine)) {
        throw new Error(`--voting-machine must be a 0x address (got "${opts.votingMachine}")`);
      }
      const reader = makeWriteContext(env, chainId, logger, defaults.name);
      const dataWarehouse = await reader.publicClient.readContract({
        address: opts.votingMachine as Address,
        abi: votingMachineAbi,
        functionName: 'DATA_WAREHOUSE',
      });
      config = {
        ...defaults,
        votingMachine: opts.votingMachine as Address,
        dataWarehouse: dataWarehouse as Address,
      };
      logger.info('submit-roots-for-block: resolved DataWarehouse from voting machine', {
        votingMachine: opts.votingMachine,
        dataWarehouse,
      });
    }

    const ctx = makeWriteContext(env, chainId, logger, config.name);
    const {txHash} = await submitStorageRootsForBlock(
      {...ctx, ethRpcUrl: ethRpcUrl(env)},
      {l1BlockHash: blockHash, config},
    );
    logger.info('submit-roots-for-block: done', {txHash});
  });

program
  .command('create-vote <proposalId>')
  .description('startProposalVote on the voting chain (chain auto-resolved from proposal)')
  .option('--chain <name>', 'override voting chain (ethereum|polygon|avalanche)')
  .action(async (idStr: string, opts: {chain?: string}) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const proposalId = BigInt(idStr);
    const {chainId, chainName} = await resolveVotingChainForProposal(
      env,
      logger,
      proposalId,
      opts.chain,
    );
    logger.info('create-vote: resolved chain', {chain: chainName, chainId});
    const ctx = makeWriteContext(env, chainId, logger, chainName);
    const {txHash} = await createVoteAction.execute(ctx, proposalId);
    logger.info('create-vote: done', {txHash});
  });

program
  .command('close-vote <proposalId>')
  .description('closeAndSendVote on the voting chain (chain auto-resolved from proposal)')
  .option('--chain <name>', 'override voting chain (ethereum|polygon|avalanche)')
  .action(async (idStr: string, opts: {chain?: string}) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const proposalId = BigInt(idStr);
    const {chainId, chainName} = await resolveVotingChainForProposal(
      env,
      logger,
      proposalId,
      opts.chain,
    );
    logger.info('close-vote: resolved chain', {chain: chainName, chainId});
    const ctx = makeWriteContext(env, chainId, logger, chainName);
    const {txHash} = await closeAndSendVoteAction.execute(ctx, proposalId);
    logger.info('close-vote: done', {txHash});
  });

program
  .command('execute-payload <payloadId>')
  .description('executePayload on a payload execution chain')
  .requiredOption('--chain <name>', 'execution chain name')
  .action(async (idStr: string, opts: {chain: string}) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const chainId = resolveExecutionChainByName(opts.chain);
    const ctx = makeWriteContext(env, chainId, logger, EXECUTION_CHAINS[chainId]!.name);
    const {txHash} = await executePayloadAction.execute(ctx, BigInt(idStr));
    logger.info('execute-payload: done', {txHash});
  });

// -------- bulk scan commands --------
program
  .command('run-governance')
  .description('Scan governance chain (last 25 proposals) and execute any actionable items')
  .action(async () => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const ctx = makeWriteContext(env, GOVERNANCE_CHAIN_ID, logger, 'ethereum');
    const results = await runGovernanceScan(ctx);
    logger.info('run-governance: done', {results: JSON.stringify(results, replacer)});
  });

program
  .command('run-voting')
  .description(
    'Scan voting chain(s). With --chain runs only that chain; without, scans all (eth, polygon, avax).',
  )
  .option('--chain <name>', 'voting chain (ethereum|polygon|avalanche). Omit to scan all.')
  .action(async (opts: {chain?: string}) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const chainIds = opts.chain
      ? [resolveVotingChainByName(opts.chain)]
      : (Object.keys(VOTING_CHAINS).map(Number) as VotingChainId[]);
    for (const chainId of chainIds) {
      const name = VOTING_CHAINS[chainId]!.name;
      try {
        const ctx = makeWriteContext(env, chainId, logger, name);
        const results = await runVotingScan({...ctx, ethRpcUrl: ethRpcUrl(env)});
        logger.info('run-voting: done', {chain: name, results: JSON.stringify(results, replacer)});
      } catch (err) {
        logger.error('run-voting: chain failed', {
          chain: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

program
  .command('run-execution')
  .description(
    'Scan payload execution chain(s). With --chain runs only that chain; without, scans all.',
  )
  .option('--chain <name>', 'execution chain name. Omit to scan every chain in EXECUTION_CHAINS.')
  .action(async (opts: {chain?: string}) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const chainIds = opts.chain
      ? [resolveExecutionChainByName(opts.chain)]
      : Object.keys(EXECUTION_CHAINS).map(Number);
    for (const chainId of chainIds) {
      const name = EXECUTION_CHAINS[chainId]!.name;
      try {
        const ctx = makeWriteContext(env, chainId, logger, name);
        const results = await runExecutionScan(ctx);
        logger.info('run-execution: done', {
          chain: name,
          results: JSON.stringify(results, replacer),
        });
      } catch (err) {
        logger.error('run-execution: chain failed', {
          chain: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

const replacer = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
