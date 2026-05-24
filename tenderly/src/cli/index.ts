#!/usr/bin/env bun
import {Command} from 'commander';
import {
  GOVERNANCE_CHAIN_ID,
  VOTING_CHAINS,
  EXECUTION_CHAINS,
  PROOF_OF_RESERVE_CHAINS,
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
  proofOfReservesAction,
  submitStorageRootsForBlock,
} from '../core/actions';
import {createLogger} from '../core/logger';
import {colorFormatter} from './logFormat';
import {inspectProposal, type InspectorConfig} from '../orchestration/proposalInspector';
import {formatInspectorReport} from './format';
import {decodeProposal, formatDecodeResult} from './decode';
import {fetchIpfsText, ipfsHashToCidV0, parseProposalMarkdown} from '../core/ipfs';
import {notifyProposalEvent} from '../core/notifyEvent';
import {LIFECYCLE_EVENTS, type LifecycleEventName} from '../core/lifecycle-events';
import {getPublicClient} from '../core/clients';
import {findRedeemable, formatRedeemableReport} from './redeemable';
import {collectHealth, formatHealthAlert, formatHealthFull, formatHealthReport} from './health';
import {runGovernanceScan} from '../orchestration/governanceScan';
import {runVotingScan} from '../orchestration/votingScan';
import {runExecutionScan} from '../orchestration/executionScan';
import {runProofOfReservesScan} from '../orchestration/proofOfReservesScan';
import {buildInspectorClients, ethRpcUrls, makeWriteContext} from './clientFactory';
import {loadEnv, requirePrivateKey, type Env} from './env';
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

const resolveProofOfReserveChainByName = (name: string): number => {
  const lower = name.toLowerCase();
  for (const id of Object.keys(PROOF_OF_RESERVE_CHAINS).map(Number)) {
    if (PROOF_OF_RESERVE_CHAINS[id]!.name === lower) return id;
  }
  throw new Error(
    `unknown proof-of-reserves chain: ${name} (configured: ${Object.values(PROOF_OF_RESERVE_CHAINS)
      .map((c) => c.name)
      .join(', ')})`,
  );
};

/**
 * Resolve a PoR executor reference to {chainId, executor address, label}. Accepts:
 *  - a 0x-address    → finds the chain that has it registered (via PROOF_OF_RESERVE_CHAINS).
 *  - a label string  → e.g. "aave-v2"/"aave-v3" together with --chain to disambiguate.
 */
const resolveProofOfReserveExecutor = (
  ref: string,
  chainOpt?: string,
): {chainId: number; executor: Address; label: string} => {
  const isAddress = /^0x[0-9a-fA-F]{40}$/.test(ref);
  if (isAddress) {
    const lower = ref.toLowerCase();
    for (const id of Object.keys(PROOF_OF_RESERVE_CHAINS).map(Number)) {
      const cfg = PROOF_OF_RESERVE_CHAINS[id]!;
      const found = cfg.executors.find((e) => e.address.toLowerCase() === lower);
      if (found) return {chainId: id, executor: found.address, label: found.label};
    }
    throw new Error(
      `executor ${ref} is not registered in PROOF_OF_RESERVE_CHAINS — add it to chains.ts first`,
    );
  }
  if (!chainOpt) {
    throw new Error(`label "${ref}" needs --chain to disambiguate`);
  }
  const chainId = resolveProofOfReserveChainByName(chainOpt);
  const cfg = PROOF_OF_RESERVE_CHAINS[chainId]!;
  const found = cfg.executors.find((e) => e.label === ref);
  if (!found) {
    throw new Error(
      `unknown PoR label "${ref}" on ${cfg.name} (available: ${cfg.executors.map((e) => e.label).join(', ')})`,
    );
  }
  return {chainId, executor: found.address, label: found.label};
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

// -------- health --------
program
  .command('health')
  .description(
    'Check signer EOA balance + gas price across every chain we sign on, and report ' +
      'how many full action rounds the balance can cover. Flags chains below threshold. ' +
      'With --notify, posts a Slack/Telegram alert only when a chain is below threshold ' +
      '(silent on healthy). With --notify-full, posts a full per-chain report on every ' +
      'run regardless of status (heartbeat-style).',
  )
  .option('--min-rounds <n>', 'warn when remaining rounds drops below this number', '10')
  .option('--notify', 'post a Slack/Telegram alert if any chain is below threshold (silent on healthy)')
  .option('--notify-full', 'post a full Slack/Telegram report on every run (includes healthy chains)')
  .action(async (opts: {minRounds: string; notify?: boolean; notifyFull?: boolean}) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const minRounds = Math.max(1, Number.parseInt(opts.minRounds, 10) || 10);
    const rows = await collectHealth(requirePrivateKey(env), logger, {minRounds});
    process.stdout.write(formatHealthReport(rows, {minRounds}) + '\n');

    if (opts.notifyFull) {
      const report = formatHealthFull(rows, {minRounds});
      const {notifyHealth} = await import('../core/notify');
      await notifyHealth({...report, logger});
      logger.info('health: posted full report', {
        chains: rows.length,
        warnChains: rows.filter((r) => r.status === 'warn' || r.status === 'critical').length,
        errorChains: rows.filter((r) => r.status === 'error').length,
      });
    } else if (opts.notify) {
      const alert = formatHealthAlert(rows, {minRounds});
      if (alert) {
        const {notifyHealth} = await import('../core/notify');
        await notifyHealth({...alert, logger});
        logger.info('health: posted alert', {
          warnChains: rows.filter((r) => r.status === 'warn' || r.status === 'critical').length,
          errorChains: rows.filter((r) => r.status === 'error').length,
        });
      } else {
        logger.info('health: all chains healthy, nothing to post');
      }
    }

    const hasIssue = rows.some((r) => r.status === 'critical' || r.status === 'error');
    if (hasIssue) process.exitCode = 1;
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

// -------- redeemable --------
program
  .command('redeemable')
  .description(
    'Find Aave Governance V3 cancellation-fee redemptions whose ETH would land on a given ' +
      'author address. Scans the most recent N proposals on L1; prints proposal IDs + per-proposal ' +
      'fees + ready-to-broadcast calldata. Anyone can call redeemCancellationFee — only the ' +
      'destination is fixed by the contract.',
  )
  .option('--author <addrOrEns>', 'author address or ENS name (default: aavelabs.eth)', 'aavelabs.eth')
  .option('--count <n>', 'how many recent proposals to scan (default: 50)', '50')
  .action(async (opts: {author: string; count: string}) => {
    const count = Math.max(1, Number.parseInt(opts.count, 10));
    if (!Number.isFinite(count)) throw new Error(`--count must be a positive integer, got "${opts.count}"`);
    const report = await findRedeemable({author: opts.author, count});
    process.stdout.write(formatRedeemableReport(report) + '\n');
  });

// -------- notify-test --------
//
// Local-only test harness for the proposal-lifecycle notification path. Synthesizes a
// tx with a deterministic hash and routes through `notifyProposalEvent` so we can verify
// rendering BEFORE deploying any tenderly.yaml change. Use --dry-run to skip the actual
// Slack/TG fan-out (just prints the rendered bodies to stdout); omit --dry-run to fire
// against whatever webhook env is configured.
program
  .command('notify-test')
  .description(
    "Dry-render (or fire) a proposal lifecycle notification for local testing. Useful " +
      'before changing tenderly.yaml.',
  )
  .requiredOption('--event <name>', `lifecycle event (one of: ${Object.keys(LIFECYCLE_EVENTS).join(', ')})`)
  .requiredOption('--proposalId <id>', 'proposal id (decimal)')
  .option('--chain <name>', 'chain name where the event fired (default: ethereum)', 'ethereum')
  .option(
    '--from <addr>',
    'tx.from override — set to your signer address to verify dedupe skip path. Default: 0xdead…dead (non-matching).',
    '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead',
  )
  .option('--dry-run', 'print rendered Slack/Telegram/plain bodies; do NOT post')
  .option(
    '--envelope-status <list>',
    "Synthetic envelope statuses for ProposalExecuted/ProposalResultsSent: comma-separated " +
      "list of ok|failed (one per envelope). Each status is assigned a synthetic destination " +
      "chain (137=polygon, 42161=arbitrum, 5000=mantle, …). Default: a single ok envelope.",
    '',
  )
  .action(
    async (opts: {
      event: string;
      proposalId: string;
      chain: string;
      from: string;
      dryRun?: boolean;
      envelopeStatus: string;
    }) => {
      const env = loadEnv();
      const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);

      const eventName = opts.event as LifecycleEventName;
      if (!(eventName in LIFECYCLE_EVENTS)) {
        throw new Error(
          `unknown --event "${opts.event}". Valid: ${Object.keys(LIFECYCLE_EVENTS).join(', ')}`,
        );
      }
      const proposalId = BigInt(opts.proposalId);

      // Resolve the chain. For VM events the user usually wants a non-eth chain; default
      // is ethereum since L1 events are most common.
      const resolveChainId = (name: string): number => {
        if (name === 'ethereum') return GOVERNANCE_CHAIN_ID;
        const vmId = Object.keys(VOTING_CHAINS).map(Number).find((id) => VOTING_CHAINS[id as VotingChainId]?.name === name);
        if (vmId) return vmId;
        throw new Error(`--chain "${name}" not in VOTING_CHAINS (or 'ethereum')`);
      };
      const chainId = resolveChainId(opts.chain);
      const l1Client = getPublicClient(GOVERNANCE_CHAIN_ID) as unknown as Parameters<
        typeof notifyProposalEvent
      >[0]['l1Client'];

      // Synthesize tx-from: when the user passes --from = our signer address, the listener
      // would skip in real life. We can't run the listener here without a real Tenderly
      // Event, but the notify itself doesn't know about tx.from — we just print whether
      // the dedupe WOULD have skipped, to make manual verification of step 4 easier.
      const txFrom = opts.from.toLowerCase();
      const expectedSigner = env.PRIVATE_KEY
        ? (await import('../core/clients')).accountFromPrivateKey(env.PRIVATE_KEY).toLowerCase()
        : null;
      const wouldDedupe = expectedSigner !== null && txFrom === expectedSigner;
      if (wouldDedupe) {
        process.stdout.write(
          `[notify-test] tx.from (${opts.from}) matches our signer — listener WOULD skip notification.\n`,
        );
      }

      // Synthetic envelope statuses for envelope-emitting events. Destination chain
      // assignment is a cycling lookup so the rendered output is recognisable in tests.
      const SYNTH_DESTS = [137, 42161, 5000, 8453, 10]; // polygon, arbitrum, mantle, base, optimism
      const buildSyntheticStatuses = (): import('../core/adi').EnvelopeForwardStatus[] => {
        const isEnvelopeEmitting =
          eventName === 'ProposalExecuted' || eventName === 'ProposalResultsSent';
        if (!isEnvelopeEmitting) return [];
        const raw = opts.envelopeStatus.trim();
        const items = raw === '' ? ['ok'] : raw.split(',').map((s) => s.trim());
        return items.map((status, i) => {
          const isOk = status === 'ok';
          // Deterministic envelopeId per slot so the rendered link reads sensibly in tests.
          const envelopeId = (`0x${(i + 0x22).toString(16).padStart(2, '0').repeat(32)}`) as `0x${string}`;
          return {
            envelopeId,
            destinationChainId: SYNTH_DESTS[i % SYNTH_DESTS.length]!,
            attempts: 3,
            succeeded: isOk ? 3 : 0,
            status: isOk ? 'ok' : 'failed',
          };
        });
      };

      const rendered = await notifyProposalEvent({
        proposalId,
        event: eventName,
        chainId,
        chainName: opts.chain,
        // Deterministic fake tx hash so the rendered output is stable across runs.
        txHash: ('0x' + '11'.repeat(32)) as `0x${string}`,
        l1Client,
        envelopeStatuses: buildSyntheticStatuses(),
        logger,
        dryRun: opts.dryRun ?? false,
      });

      if (opts.dryRun) {
        process.stdout.write('\n=== Slack ===\n' + rendered.slack + '\n');
        process.stdout.write('\n=== Telegram (HTML) ===\n' + rendered.tg + '\n');
        process.stdout.write('\n=== Plain ===\n' + rendered.plain + '\n');
      } else {
        process.stdout.write('[notify-test] sent (or skipped if no webhook configured)\n');
      }
    },
  );

// -------- ipfs --------
program
  .command('ipfs <hashOrCid>')
  .description(
    'Resolve an IPFS reference and print the markdown. Accepts a 32-byte hex hash ' +
      '(0x-prefixed, as stored on-chain) or a CIDv0 string (Qm…).',
  )
  .option('--raw', 'print the original markdown including YAML frontmatter (default strips it)')
  .option('--gateway <url>', 'override gateway (repeatable)', (val: string, prev: string[]) => [...prev, val], [] as string[])
  .action(async (input: string, opts: {raw?: boolean; gateway: string[]}) => {
    const trimmed = input.trim();
    const isHexHash = /^0x?[0-9a-fA-F]{64}$/.test(trimmed);
    const cid = isHexHash
      ? ipfsHashToCidV0((trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as `0x${string}`)
      : trimmed;
    const fetchOpts = opts.gateway.length > 0 ? {gateways: opts.gateway} : undefined;
    const text = await fetchIpfsText(cid, fetchOpts);
    const body = opts.raw ? text : parseProposalMarkdown(text).body;
    process.stdout.write(body.endsWith('\n') ? body : body + '\n');
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
    const result = await executeSubmitStorageRoots(
      {...ctx, ethRpcUrls: ethRpcUrls(env)},
      {proposalId, l1ProposalBlockHash: snapshotBlockHash},
    );
    if (result.txHash) logger.info('submit-roots: done', {txHash: result.txHash});
    else logger.info('submit-roots: skipped', {reason: result.skipped});
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
        ethRpcUrls(env),
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
    const result = await submitStorageRootsForBlock(
      {...ctx, ethRpcUrls: ethRpcUrls(env)},
      {l1BlockHash: blockHash, config},
    );
    if (result.txHash) logger.info('submit-roots-for-block: done', {txHash: result.txHash});
    else logger.info('submit-roots-for-block: skipped', {reason: result.skipped});
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
  .command('proof-of-reserves <executor>')
  .description(
    'executeEmergencyAction on a ProofOfReserveExecutor. <executor> may be a 0x-address ' +
      '(chain auto-resolved) or a label like "aave-v2"/"aave-v3" (requires --chain).',
  )
  .option('--chain <name>', 'PoR chain (e.g. avalanche). Required only for label-style refs.')
  .action(async (ref: string, opts: {chain?: string}) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const {chainId, executor, label} = resolveProofOfReserveExecutor(ref, opts.chain);
    const cfg = PROOF_OF_RESERVE_CHAINS[chainId]!;
    logger.info('proof-of-reserves: resolved', {chain: cfg.name, executor, label});
    const ctx = makeWriteContext(env, chainId, logger, cfg.name);
    const {txHash} = await proofOfReservesAction.execute(ctx, executor);
    logger.info('proof-of-reserves: done', {txHash});
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
        const results = await runVotingScan({...ctx, ethRpcUrls: ethRpcUrls(env)});
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

program
  .command('run-proof-of-reserves')
  .description(
    'Scan PoR-enabled chain(s) and executeEmergencyAction on any executor whose reserves ' +
      'flipped unbacked. With --chain runs only that chain; without, scans all (today: avalanche).',
  )
  .option('--chain <name>', 'PoR chain name. Omit to scan every chain in PROOF_OF_RESERVE_CHAINS.')
  .action(async (opts: {chain?: string}) => {
    const env = loadEnv();
    const logger = createLogger(resolveLogLevel(env), undefined, colorFormatter);
    const chainIds = opts.chain
      ? [resolveProofOfReserveChainByName(opts.chain)]
      : Object.keys(PROOF_OF_RESERVE_CHAINS).map(Number);
    for (const chainId of chainIds) {
      const name = PROOF_OF_RESERVE_CHAINS[chainId]!.name;
      try {
        const ctx = makeWriteContext(env, chainId, logger, name);
        const results = await runProofOfReservesScan(ctx);
        logger.info('run-proof-of-reserves: done', {
          chain: name,
          results: JSON.stringify(results, replacer),
        });
      } catch (err) {
        logger.error('run-proof-of-reserves: chain failed', {
          chain: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

const replacer = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

/**
 * Top-level CLI error handler. Posts to Slack/Telegram (best-effort, won't itself throw)
 * before exiting non-zero, so unattended cron jobs and manual runs both wake an operator
 * up on failure. Survives even if notify itself errors out.
 */
const cliCommand = (() => {
  // Best-effort sniff of which command was being run (process.argv[2..]) for the alert source.
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-')).join(' ') || 'cli';
  return args.length > 80 ? args.slice(0, 77) + '…' : args;
})();

const handleCliFailure = async (err: unknown): Promise<never> => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${msg}\n`);

  // Surface the alert via Slack/Telegram if either is configured. notifyError is
  // intentionally swallow-all-errors so a webhook outage can't mask the original failure.
  try {
    // Lazy import so the CLI's --help / --version paths don't pay the import cost.
    const {notifyError} = await import('../core/notify');
    await notifyError({source: `cli (${cliCommand})`, error: err});
  } catch (notifyErr) {
    process.stderr.write(
      `notify itself failed: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}\n`,
    );
  }

  process.exit(1);
};

// All async failures funnel here — including individual command actions (commander
// surfaces their throws via parseAsync's promise) and any top-level setup errors.
program.parseAsync(process.argv).catch(handleCliFailure);

// Catch synchronous throws and unhandled rejections that bypass commander entirely.
process.on('unhandledRejection', (reason) => {
  void handleCliFailure(reason);
});
process.on('uncaughtException', (err) => {
  void handleCliFailure(err);
});
