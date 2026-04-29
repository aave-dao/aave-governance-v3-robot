// Walk every proposal id from 0 to getProposalsCount()-1 and run the inspector + votes sync.
// Idempotent: re-running just refreshes existing rows. Designed for one-time historical
// population after running the migrations on a fresh DB.
//
// Flags:
//   --from=<id>   skip proposals with id < <id> (resume an aborted run)
//   --to=<id>     stop after proposal id <id> (default: latest)
//   --concurrency=<n>  parallel inspector calls (default 5)
//
// Votes are scanned with `unbounded: true` so each proposal gets a full historical sweep
// rather than the usual per-tick window cap.

import 'dotenv/config';
import { GovernanceV3Ethereum } from '@aave-dao/aave-address-book';
import type { Address } from 'viem';
import { governanceAbi } from '@robot/core/abis';
import { buildInspectorClientsFromEnv } from '../lib/context-factory';
import { syncVotesForProposal } from '../lib/votes-sync';
import { inspectAndCacheProposal } from '../lib/refresh';

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const fromArg = arg('from');
const toArg = arg('to');
const concurrencyArg = arg('concurrency');

const concurrency = Math.max(1, Number(concurrencyArg ?? '5') || 5);

const main = async () => {
  const bundle = buildInspectorClientsFromEnv();

  const total = await bundle.govPublic.readContract({
    address: GovernanceV3Ethereum.GOVERNANCE as Address,
    abi: governanceAbi,
    functionName: 'getProposalsCount',
  });
  const lastId = total > 0n ? total - 1n : -1n;
  if (lastId < 0n) {
    console.log('no proposals on-chain yet');
    return;
  }

  const from = fromArg !== undefined ? BigInt(fromArg) : 0n;
  const to = toArg !== undefined ? BigInt(toArg) : lastId;
  const target = to > lastId ? lastId : to;
  if (from > target) {
    console.log(`nothing to do (from=${from} > to=${target})`);
    return;
  }

  const ids: bigint[] = [];
  for (let id = from; id <= target; id++) ids.push(id);
  console.log(
    `backfill: ${ids.length} proposal(s) — from=${from} to=${target} concurrency=${concurrency}`,
  );

  let done = 0;
  let failed = 0;
  const startedAt = Date.now();

  // Simple bounded parallelism using a sliding pool.
  const work = async (id: bigint): Promise<void> => {
    const t0 = Date.now();
    try {
      // Inspect + upsert proposal/payloads (also runs a normal capped votes sync).
      const rep = await inspectAndCacheProposal(id);

      // Full unbounded vote sweep — fills any gap left by the per-run cap.
      if (rep.voting) {
        const vmClient = bundle.votingClients[rep.voting.chainId];
        if (vmClient) {
          await syncVotesForProposal({
            proposalId: id,
            votingChainId: rep.voting.chainId,
            vmClient,
            logger: bundle.logger,
            unbounded: true,
          });
        }
      }
      done += 1;
      console.log(
        `  ✓ #${id} (${Date.now() - t0}ms)  [${done + failed}/${ids.length}]`,
      );
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ #${id}: ${msg}  [${done + failed}/${ids.length}]`);
    }
  };

  const queue = ids.slice();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) {
        const id = queue.shift()!;
        await work(id);
      }
    }),
  );

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nbackfill complete — ${done}/${ids.length} ok, ${failed} failed, ${elapsed}s`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
