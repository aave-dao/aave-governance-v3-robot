// One-shot: run every cron's body in-process so the cache DB gets populated and the listener
// cursor advances. Equivalent to hitting all 25 cron HTTP endpoints once, but skips the network
// hop and the CRON_SECRET dance.
//
// Side effects (be aware before running on a prod signer):
//   - cache-refresh: reads-only, writes proposals + payloads rows
//   - listener-poll: reads VotingActivated logs, MAY send submitStorageRoots tx if a new
//     activation was missed
//   - governance-scan / voting-all / exec-scan-*: scans every chain and SENDS A TX for any
//     proposal/payload that is currently eligible (same as the production crons would do)
//   - health-daily: read-only; posts Slack/Telegram if any chain is below threshold
//
// Usage:
//   bun run scripts/run-all-crons.ts                    # all crons
//   bun run scripts/run-all-crons.ts --only=cache       # only cache-refresh
//   bun run scripts/run-all-crons.ts --only=cache,listener
//   bun run scripts/run-all-crons.ts --skip-tx          # skip everything that may send a tx
//
// Available step names: cache, listener, governance, voting, exec, health

import 'dotenv/config';

import { collectHealth, formatHealthAlert } from '@robot/cli/health';
import { notifyHealth } from '@robot/core/notify';
import { GOVERNANCE_CHAIN_ID, EXECUTION_CHAINS, VOTING_CHAINS, type VotingChainId } from '@robot/core/chains';
import { runGovernanceScan } from '@robot/orchestration/governanceScan';
import { runVotingScan } from '@robot/orchestration/votingScan';
import { runExecutionScan } from '@robot/orchestration/executionScan';

import { recordCronRun } from '../lib/cron-runs';
import { ethRpcUrlFromEnv, makeWriteContextFromEnv } from '../lib/context-factory';
import { requirePrivateKey } from '../lib/env';
import { getLogger } from '../lib/logger';
import { runListenerPoll } from '../lib/listener';
import { runCacheRefresh } from '../lib/refresh';
import { jsonSafe } from '../lib/serialize';

type Step = {
  name: string;
  group: 'cache' | 'listener' | 'governance' | 'voting' | 'exec' | 'health';
  /** Mutating cron — may send txs (governance/voting/exec). Cache + listener + health are mostly read. */
  mayTx: boolean;
  run: () => Promise<unknown>;
};

const argv = process.argv.slice(2);
const onlyArg = argv.find((a) => a.startsWith('--only='))?.slice(7);
const skipTx = argv.includes('--skip-tx');

const onlyGroups = onlyArg
  ? new Set(onlyArg.split(',').map((s) => s.trim()))
  : null;

const buildSteps = (): Step[] => {
  const steps: Step[] = [];

  steps.push({
    name: 'cache-refresh',
    group: 'cache',
    mayTx: false,
    run: () => runCacheRefresh(),
  });

  steps.push({
    name: 'listener-poll',
    group: 'listener',
    mayTx: true, // can submit storage roots
    run: () => runListenerPoll(),
  });

  steps.push({
    name: 'governance-scan',
    group: 'governance',
    mayTx: true,
    run: async () => {
      const ctx = makeWriteContextFromEnv(GOVERNANCE_CHAIN_ID, 'ethereum');
      return { results: await runGovernanceScan(ctx) };
    },
  });

  steps.push({
    name: 'voting-all',
    group: 'voting',
    mayTx: true,
    run: async () => {
      const summaries: Array<{ chainId: number; chainName: string; results?: unknown; error?: string }> = [];
      for (const chainIdStr of Object.keys(VOTING_CHAINS)) {
        const chainId = Number(chainIdStr) as VotingChainId;
        const chainName = VOTING_CHAINS[chainId]!.name;
        try {
          const ctx = makeWriteContextFromEnv(chainId, chainName);
          const results = await runVotingScan({ ...ctx, ethRpcUrl: ethRpcUrlFromEnv() });
          summaries.push({ chainId, chainName, results });
        } catch (err) {
          summaries.push({
            chainId,
            chainName,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { summaries };
    },
  });

  for (const chainIdStr of Object.keys(EXECUTION_CHAINS)) {
    const chainId = Number(chainIdStr);
    const chainName = EXECUTION_CHAINS[chainId]!.name;
    steps.push({
      name: `exec-scan-${chainName}`,
      group: 'exec',
      mayTx: true,
      run: async () => {
        const ctx = makeWriteContextFromEnv(chainId, chainName);
        return { chainId, chainName, results: await runExecutionScan(ctx) };
      },
    });
  }

  steps.push({
    name: 'health-daily',
    group: 'health',
    mayTx: false,
    run: async () => {
      const logger = getLogger();
      const rows = await collectHealth(requirePrivateKey(), logger, { minRounds: 50 });
      const alert = formatHealthAlert(rows, { minRounds: 50 });
      let posted = false;
      if (alert) {
        await notifyHealth({ ...alert, logger });
        posted = true;
      }
      return {
        posted,
        chains: rows.map((r) => ({
          chainId: r.chainId,
          name: r.name,
          status: r.status,
          rounds: r.rounds === Infinity ? null : r.rounds,
        })),
      };
    },
  });

  return steps;
};

const main = async () => {
  const all = buildSteps();
  const selected = all.filter((s) => {
    if (onlyGroups && !onlyGroups.has(s.group)) return false;
    if (skipTx && s.mayTx) return false;
    return true;
  });

  if (selected.length === 0) {
    console.error('no steps selected — check --only / --skip-tx');
    process.exit(1);
  }

  console.log(`running ${selected.length} step(s):`);
  for (const s of selected) console.log(`  • ${s.name}${s.mayTx ? '  (may send tx)' : ''}`);
  console.log('');

  let failures = 0;
  for (const step of selected) {
    const started = Date.now();
    process.stdout.write(`▶ ${step.name}…\n`);
    try {
      const summary = await step.run();
      const durationMs = Date.now() - started;
      await recordCronRun({ name: step.name, ok: true, durationMs, summary });
      console.log(`  ✓ ${step.name} (${durationMs}ms)`);
      const safe = jsonSafe(summary);
      if (safe && typeof safe === 'object') {
        const trimmed = JSON.stringify(safe).slice(0, 300);
        console.log(`    summary: ${trimmed}${trimmed.length === 300 ? '…' : ''}`);
      }
    } catch (err) {
      failures += 1;
      const durationMs = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);
      await recordCronRun({ name: step.name, ok: false, durationMs, error: message });
      console.error(`  ✗ ${step.name} (${durationMs}ms): ${message}`);
    }
  }

  console.log('');
  console.log(`done — ${selected.length - failures}/${selected.length} ok, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
