// ENS reverse resolution + cache. Each lookup reads the cache first; misses are resolved on
// L1 via viem's `getEnsName` (which does the reverse PTR + forward verify in one call).
// Results are persisted with a 7-day TTL so we don't re-resolve constantly.

import { eq, inArray } from 'drizzle-orm';
import type { Address } from 'viem';
import { mainnet } from 'viem/chains';
import { GOVERNANCE_CHAIN_ID } from '@robot/core/chains';
import { getPublicClient } from '@robot/core/clients';
import { db } from '@/db/client';
import { ensNames } from '@/db/schema';
import { getLogger } from './logger';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 8;

const lower = (a: string) => a.toLowerCase() as `0x${string}`;

/**
 * Read the ENS cache for the given addresses. Any addresses missing from the cache *or*
 * with `expires_at < now()` are resolved fresh against L1 in parallel-bounded batches.
 *
 * Returns a Map<lowercased-address, ensName | null>. `null` means "no ENS for this address"
 * (cached negative result so we don't re-query).
 */
export const getEnsForAddresses = async (
  addresses: string[],
): Promise<Map<string, string | null>> => {
  const result = new Map<string, string | null>();
  if (addresses.length === 0) return result;

  const lowered = Array.from(new Set(addresses.map(lower)));

  // Pull whatever is in cache.
  const cached = await db
    .select()
    .from(ensNames)
    .where(inArray(ensNames.address, lowered));
  const now = Date.now();
  const stale: string[] = [];
  for (const c of cached) {
    if (c.expiresAt.getTime() < now) {
      stale.push(c.address);
    } else {
      result.set(c.address, c.name);
    }
  }
  const missing = lowered.filter((a) => !result.has(a) && !stale.includes(a));
  const toResolve = [...missing, ...stale];
  if (toResolve.length === 0) return result;

  // Resolve fresh.
  const client = getPublicClient(GOVERNANCE_CHAIN_ID);
  const logger = getLogger();
  const resolved = new Map<string, string | null>();

  // Bounded parallelism: resolve up to CONCURRENCY at a time.
  for (let i = 0; i < toResolve.length; i += CONCURRENCY) {
    const slice = toResolve.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      slice.map((addr) =>
        client.getEnsName({
          address: addr as Address,
          // Force universal resolver via the L1 chain context already set on the client.
        }),
      ),
    );
    settled.forEach((res, idx) => {
      const addr = slice[idx]!;
      if (res.status === 'fulfilled') {
        resolved.set(addr, res.value ?? null);
      } else {
        logger.warn('ens-resolve: lookup failed', {
          address: addr,
          error: res.reason instanceof Error ? res.reason.message : String(res.reason),
        });
        // Don't cache transient failures as null; just skip — next call will retry.
      }
    });
  }

  // Persist (upsert) — separate awaits to avoid one bad row blocking the rest.
  const expires = new Date(now + TTL_MS);
  for (const [addr, name] of resolved) {
    try {
      await db
        .insert(ensNames)
        .values({ address: addr, name, expiresAt: expires, resolvedAt: new Date() })
        .onConflictDoUpdate({
          target: ensNames.address,
          set: { name, expiresAt: expires, resolvedAt: new Date() },
        });
    } catch (err) {
      logger.warn('ens-resolve: cache upsert failed', {
        address: addr,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    result.set(addr, name);
  }

  // Make sure unresolved-but-not-rejected entries are still in the result map.
  for (const a of toResolve) {
    if (!result.has(a)) result.set(a, null);
  }
  return result;
};

/** Convenience: lookup a single address; returns ENS name or null. */
export const getEnsForAddress = async (address: string): Promise<string | null> => {
  const m = await getEnsForAddresses([address]);
  return m.get(lower(address)) ?? null;
};

/** Avoid unused-import warnings: the chain import is here to document we hit L1 only. */
void mainnet;
