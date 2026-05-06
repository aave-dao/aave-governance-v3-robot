// Shared loader used by both the SSR page and the JSON API for the proposal detail. Keeps
// the SQL + ENS-decoration logic in one place so the two surfaces never drift.

import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ensNames, executions, payloads, proposals, votes } from '@/db/schema';
import { getEnsForAddresses } from './ens-resolve';
import { loadLifecycleTxs, type LifecycleTxs } from './lifecycle-txs';

export type VoteWithEns = {
  proposalId: bigint;
  votingChainId: number;
  voter: string;
  support: boolean;
  votingPower: string;
  txHash: string;
  blockNumber: bigint;
  logIndex: number;
  createdAt: Date;
  ensName: string | null;
};

export type EnsLookup = Record<string, string | null>;

export type ProposalDetailBundle = {
  proposal: typeof proposals.$inferSelect;
  payloads: (typeof payloads.$inferSelect)[];
  executions: (typeof executions.$inferSelect)[];
  votes: VoteWithEns[];
  /** Map of lowercased address → ENS name (or null). Includes voters + creator + portal. */
  ens: EnsLookup;
  /** Tx hashes for the proposal's on-chain lifecycle events (best-effort). */
  lifecycleTxs: LifecycleTxs;
};

const lower = (a: string) => a.toLowerCase();

export const loadProposalDetail = async (id: bigint): Promise<ProposalDetailBundle | null> => {
  const [proposal] = await db.select().from(proposals).where(eq(proposals.id, id));
  if (!proposal) return null;

  const [proposalPayloads, recentExecutions, proposalVotes] = await Promise.all([
    db.select().from(payloads).where(eq(payloads.proposalId, id)),
    db
      .select()
      .from(executions)
      .where(eq(executions.proposalId, id))
      .orderBy(desc(executions.createdAt))
      .limit(10),
    db
      .select({
        proposalId: votes.proposalId,
        votingChainId: votes.votingChainId,
        voter: votes.voter,
        support: votes.support,
        votingPower: votes.votingPower,
        txHash: votes.txHash,
        blockNumber: votes.blockNumber,
        logIndex: votes.logIndex,
        createdAt: votes.createdAt,
        // LOWER() on the join key so the index works regardless of how the address was stored.
        ensName: ensNames.name,
      })
      .from(votes)
      .leftJoin(ensNames, sql`lower(${votes.voter}) = ${ensNames.address}`)
      .where(eq(votes.proposalId, id))
      .orderBy(asc(votes.blockNumber), asc(votes.logIndex)),
  ]);

  // Best-effort ENS lookup for header addresses (creator + voting portal + any voter not yet
  // covered by the JOIN). Populates the cache for next time.
  const headerAddrs = [proposal.creator, proposal.votingPortal].filter(Boolean) as string[];
  const allAddrs = Array.from(
    new Set([...headerAddrs, ...proposalVotes.map((v) => v.voter)].map(lower)),
  );

  const ens: EnsLookup = {};
  if (allAddrs.length > 0) {
    const cached = await db
      .select()
      .from(ensNames)
      .where(inArray(ensNames.address, allAddrs));
    for (const c of cached) ens[c.address] = c.name;

    // Warm any header addresses missing from the cache (don't block the page on this).
    const missing = headerAddrs.filter((a) => !(lower(a) in ens));
    if (missing.length > 0) {
      try {
        const fresh = await getEnsForAddresses(missing);
        for (const [a, n] of fresh) ens[a] = n;
      } catch {
        // ignore — best-effort.
      }
    }
  }

  // Lifecycle event tx hashes are indexed asynchronously by `lib/lifecycle-index.ts` (runs
  // from `upsertReport()` during cache-refresh + first-visit fallback). Here we just read
  // the cache — no RPC at request time. Empty result is fine; the next cron tick will fill
  // in any newly-emitted events.
  let lifecycleTxs: LifecycleTxs = { payloadQueued: {}, payloadExecuted: {} };
  try {
    lifecycleTxs = await loadLifecycleTxs(id, proposal.votingPortal ?? null);
  } catch {
    // best-effort — page still renders without these links.
  }

  return {
    proposal,
    payloads: proposalPayloads,
    executions: recentExecutions,
    votes: proposalVotes as VoteWithEns[],
    ens,
    lifecycleTxs,
  };
};
