#!/usr/bin/env bun
import { Command } from 'commander';
import { GOVERNANCE_CHAIN_ID, VOTING_CHAINS, EXECUTION_CHAINS, type VotingChainId } from '../core/chains';
import {
  activateVotingAction,
  cancelProposalAction,
  closeAndSendVoteAction,
  createVoteAction,
  executePayloadAction,
  executeProposalAction,
  executeSubmitStorageRoots,
} from '../core/actions';
import { createLogger } from '../core/logger';
import {
  inspectProposal,
  type InspectorConfig,
} from '../orchestration/proposalInspector';
import { formatInspectorReport } from './format';
import { decodeProposal, formatDecodeResult } from './decode';
import { runGovernanceScan } from '../orchestration/governanceScan';
import { runVotingScan } from '../orchestration/votingScan';
import { runExecutionScan } from '../orchestration/executionScan';
import { buildInspectorClients, ethRpcUrl, makeWriteContext } from './clientFactory';
import { loadEnv } from './env';
import { governanceAbi } from '../core/abis';
import { GovernanceV3Ethereum } from '@aave-dao/aave-address-book';
import type { Address } from 'viem';

const program = new Command();
program
  .name('aave-gov-robot')
  .description('Aave Governance V3 robot (Tenderly + CLI)')
  .version('0.1.0');

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

// -------- inspect --------
program
  .command('inspect <proposalId>')
  .description('Walk a proposal through every lifecycle stage and report what is missing')
  .option('--no-metadata', 'skip the IPFS title/author fetch')
  .action(async (idStr: string, opts: { metadata: boolean }) => {
    const env = loadEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const proposalId = BigInt(idStr);
    const { govPublic, votingClients, executionClients } = buildInspectorClients(env);
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
  .description('Fetch + decode a proposal: title, author, discussions, payloads, optionally full body')
  .option('--full', 'print the full proposal body from IPFS')
  .option('--no-metadata', 'skip the IPFS fetch (only print on-chain fields)')
  .action(async (idStr: string, opts: { full?: boolean; metadata: boolean }) => {
    loadEnv();
    const result = await decodeProposal(BigInt(idStr), { fetchMetadata: opts.metadata !== false });
    process.stdout.write(formatDecodeResult(result, { full: opts.full }) + '\n');
  });

// -------- per-action commands --------
program
  .command('activate <proposalId>')
  .description('activateVoting on the governance chain')
  .action(async (idStr: string) => {
    const env = loadEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const ctx = makeWriteContext(env, GOVERNANCE_CHAIN_ID, logger, 'ethereum');
    const { txHash } = await activateVotingAction.execute(ctx, BigInt(idStr));
    logger.info('activate: done', { txHash });
  });

program
  .command('execute <proposalId>')
  .description('executeProposal on the governance chain')
  .action(async (idStr: string) => {
    const env = loadEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const ctx = makeWriteContext(env, GOVERNANCE_CHAIN_ID, logger, 'ethereum');
    const { txHash } = await executeProposalAction.execute(ctx, BigInt(idStr));
    logger.info('execute: done', { txHash });
  });

program
  .command('cancel <proposalId>')
  .description('cancelProposal on the governance chain')
  .action(async (idStr: string) => {
    const env = loadEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const ctx = makeWriteContext(env, GOVERNANCE_CHAIN_ID, logger, 'ethereum');
    const { txHash } = await cancelProposalAction.execute(ctx, BigInt(idStr));
    logger.info('cancel: done', { txHash });
  });

program
  .command('submit-roots <proposalId>')
  .description('Submit storage roots to a voting chain DataWarehouse via Multicall3.aggregate3')
  .requiredOption('--chain <name>', 'voting chain (ethereum|polygon|avalanche)')
  .action(async (idStr: string, opts: { chain: string }) => {
    const env = loadEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const proposalId = BigInt(idStr);
    const chainId = resolveVotingChainByName(opts.chain);
    const config = VOTING_CHAINS[chainId]!;

    // Read snapshot block hash from L1 governance.
    const govCtx = makeWriteContext(env, GOVERNANCE_CHAIN_ID, logger, 'ethereum');
    const proposal = await govCtx.publicClient.readContract({
      address: GovernanceV3Ethereum.GOVERNANCE as Address,
      abi: governanceAbi,
      functionName: 'getProposal',
      args: [proposalId],
    });

    const ctx = makeWriteContext(env, chainId, logger, config.name);
    const { txHash } = await executeSubmitStorageRoots(
      { ...ctx, ethRpcUrl: ethRpcUrl(env) },
      { proposalId, l1ProposalBlockHash: proposal.snapshotBlockHash as `0x${string}` },
    );
    logger.info('submit-roots: done', { txHash });
  });

program
  .command('create-vote <proposalId>')
  .description('startProposalVote on a voting chain')
  .requiredOption('--chain <name>', 'voting chain (ethereum|polygon|avalanche)')
  .action(async (idStr: string, opts: { chain: string }) => {
    const env = loadEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const chainId = resolveVotingChainByName(opts.chain);
    const ctx = makeWriteContext(env, chainId, logger, VOTING_CHAINS[chainId]!.name);
    const { txHash } = await createVoteAction.execute(ctx, BigInt(idStr));
    logger.info('create-vote: done', { txHash });
  });

program
  .command('close-vote <proposalId>')
  .description('closeAndSendVote on a voting chain')
  .requiredOption('--chain <name>', 'voting chain (ethereum|polygon|avalanche)')
  .action(async (idStr: string, opts: { chain: string }) => {
    const env = loadEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const chainId = resolveVotingChainByName(opts.chain);
    const ctx = makeWriteContext(env, chainId, logger, VOTING_CHAINS[chainId]!.name);
    const { txHash } = await closeAndSendVoteAction.execute(ctx, BigInt(idStr));
    logger.info('close-vote: done', { txHash });
  });

program
  .command('execute-payload <payloadId>')
  .description('executePayload on a payload execution chain')
  .requiredOption('--chain <name>', 'execution chain name')
  .action(async (idStr: string, opts: { chain: string }) => {
    const env = loadEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const chainId = resolveExecutionChainByName(opts.chain);
    const ctx = makeWriteContext(env, chainId, logger, EXECUTION_CHAINS[chainId]!.name);
    const { txHash } = await executePayloadAction.execute(ctx, BigInt(idStr));
    logger.info('execute-payload: done', { txHash });
  });

// -------- bulk scan commands --------
program
  .command('run-governance')
  .description('Scan governance chain (last 25 proposals) and execute any actionable items')
  .action(async () => {
    const env = loadEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const ctx = makeWriteContext(env, GOVERNANCE_CHAIN_ID, logger, 'ethereum');
    const results = await runGovernanceScan(ctx);
    logger.info('run-governance: done', { results: JSON.stringify(results, replacer) });
  });

program
  .command('run-voting')
  .description('Scan a voting chain and execute submitRoots/createVote/closeAndSend as needed')
  .requiredOption('--chain <name>', 'voting chain (ethereum|polygon|avalanche)')
  .action(async (opts: { chain: string }) => {
    const env = loadEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const chainId = resolveVotingChainByName(opts.chain);
    const ctx = makeWriteContext(env, chainId, logger, VOTING_CHAINS[chainId]!.name);
    const results = await runVotingScan({ ...ctx, ethRpcUrl: ethRpcUrl(env) });
    logger.info('run-voting: done', { results: JSON.stringify(results, replacer) });
  });

program
  .command('run-execution')
  .description('Scan a payload execution chain and execute eligible payloads')
  .requiredOption('--chain <name>', 'execution chain name')
  .action(async (opts: { chain: string }) => {
    const env = loadEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const chainId = resolveExecutionChainByName(opts.chain);
    const ctx = makeWriteContext(env, chainId, logger, EXECUTION_CHAINS[chainId]!.name);
    const results = await runExecutionScan(ctx);
    logger.info('run-execution: done', { results: JSON.stringify(results, replacer) });
  });

const replacer = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
