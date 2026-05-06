// One-off backfill for the payloads-table fix (migration 0006_payloads_per_proposal).
//
// Pre-migration, payloads_pk was unique on (chain_id, payload_id), so two proposals
// referencing the same payload (e.g. rsETH #477 + #478) clobbered each other and one
// always rendered with zero payload rows. Post-migration the unique key is per-proposal,
// but existing rows in the DB still reflect the last writer — older proposals outside
// the cron's last-20 refresh window stay broken until something re-inspects them.
//
// This script rebuilds the payloads table by walking every cached proposal's
// `raw.payloads` blob (which already holds the full inspector output) and upserting
// the per-proposal rows. NO RPC calls — pure DB rewrite, idempotent, fast.
//
// Run after `bun run db:migrate`:  `bun run scripts/backfill-payload-rows.ts`

import 'dotenv/config';
import { db } from '../db/client';
import {
  payloads,
  proposals,
  type EligibilityCheck,
} from '../db/schema';
import { jsonSafe } from '../lib/serialize';

type ActionStatusLike = {
  name: string;
  status: 'ready' | 'blocked' | 'done';
  reason?: string;
  etaAt?: number;
};

type RawPayload = {
  chainId: number;
  chainName: string;
  payloadId: number;
  payloadsController: string;
  state: string;
  stateNumber: number;
  actionCount: number;
  createdAt?: number;
  queuedAt?: number;
  executedAt?: number;
  cancelledAt?: number;
  expirationTime?: number;
  delay?: number;
  gracePeriod?: number;
  executionActions?: unknown[];
  actions?: ActionStatusLike[];
};

const toCheck = (a: ActionStatusLike | undefined): EligibilityCheck => {
  if (!a) return { eligible: false, reason: 'no status' };
  if (a.status === 'ready') return { eligible: true };
  if (a.status === 'done') return { eligible: false, reason: a.reason ?? '', done: true };
  return { eligible: false, reason: a.reason ?? '', etaAt: a.etaAt };
};

const main = async () => {
  const all = await db.select().from(proposals);
  console.log(`backfill: walking ${all.length} cached proposal(s)`);

  let proposalsTouched = 0;
  let rowsUpserted = 0;
  let skipped = 0;

  for (const p of all) {
    const raw = p.raw as { payloads?: RawPayload[] } | null;
    const list = Array.isArray(raw?.payloads) ? raw!.payloads : [];
    if (list.length === 0) {
      skipped += 1;
      continue;
    }
    proposalsTouched += 1;

    for (const r of list) {
      if (
        typeof r?.chainId !== 'number' ||
        typeof r?.payloadId !== 'number' ||
        typeof r?.payloadsController !== 'string'
      ) {
        continue;
      }
      const executable = toCheck(r.actions?.find((a) => a.name === 'executePayload'));
      const rawBlob = jsonSafe({
        createdAt: r.createdAt ?? null,
        queuedAt: r.queuedAt ?? null,
        executedAt: r.executedAt ?? null,
        cancelledAt: r.cancelledAt ?? null,
        expirationTime: r.expirationTime ?? null,
        delay: r.delay ?? null,
        gracePeriod: r.gracePeriod ?? null,
        executionActions: r.executionActions ?? [],
      }) as object;

      const row = {
        chainId: r.chainId,
        payloadId: r.payloadId,
        proposalId: p.id,
        chainName: r.chainName ?? `chain-${r.chainId}`,
        payloadsController: r.payloadsController,
        state: r.stateNumber ?? -1,
        stateName: r.state ?? 'unknown',
        actionCount: r.actionCount ?? 0,
        queuedAt: r.queuedAt && r.queuedAt > 0 ? r.queuedAt : null,
        delay: r.delay ?? null,
        executable,
        raw: rawBlob,
        refreshedAt: new Date(),
      };

      await db
        .insert(payloads)
        .values(row)
        .onConflictDoUpdate({
          target: [payloads.chainId, payloads.payloadId, payloads.proposalId],
          set: {
            chainName: row.chainName,
            payloadsController: row.payloadsController,
            state: row.state,
            stateName: row.stateName,
            actionCount: row.actionCount,
            queuedAt: row.queuedAt,
            delay: row.delay,
            executable: row.executable,
            raw: row.raw,
            refreshedAt: row.refreshedAt,
          },
        });
      rowsUpserted += 1;
    }
    if (proposalsTouched % 25 === 0) {
      console.log(`  …${proposalsTouched} proposals processed (${rowsUpserted} rows so far)`);
    }
  }

  console.log(
    `\nbackfill complete — ${proposalsTouched} proposal(s) processed, ` +
      `${rowsUpserted} payload row(s) upserted, ${skipped} skipped (no payloads)`,
  );
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
