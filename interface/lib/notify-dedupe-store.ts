// Postgres-backed implementation of `DedupeStore` for the interface runtime. Importing
// this module installs it as the active dedupe backend on `notifyError`. Pulled in by
// `cron-handler.ts` and the user-triggered `/api/execute` route — the only places that
// actually call `notifyError` from the Vercel runtime.

import {eq, sql} from 'drizzle-orm';
import {db} from '@/db/client';
import {notifyDedupe} from '@/db/schema';
import {setNotifyDedupeStore, type DedupeStore} from '@robot/core/notify';

const pgDedupeStore: DedupeStore = {
  async getLastNotified(fingerprint) {
    const [row] = await db
      .select({lastNotifiedAt: notifyDedupe.lastNotifiedAt})
      .from(notifyDedupe)
      .where(eq(notifyDedupe.fingerprint, fingerprint));
    if (!row) return null;
    return Math.floor(row.lastNotifiedAt.getTime() / 1000);
  },

  async setLastNotified(fingerprint, atSec, info) {
    const at = new Date(atSec * 1000);
    await db
      .insert(notifyDedupe)
      .values({
        fingerprint,
        source: info.source,
        chainId: info.chainId ?? null,
        lastNotifiedAt: at,
        // Truncate to avoid accidentally storing megabyte-sized stack dumps.
        lastMessage: info.message.slice(0, 4_000),
        count: 1,
      })
      .onConflictDoUpdate({
        target: notifyDedupe.fingerprint,
        set: {
          source: info.source,
          chainId: info.chainId ?? null,
          lastNotifiedAt: at,
          lastMessage: info.message.slice(0, 4_000),
          // Reset on a fresh fire — `count` is "suppressed since last fire", not lifetime.
          count: 1,
        },
      });
  },

  async bumpSuppressed(fingerprint) {
    await db
      .update(notifyDedupe)
      .set({count: sql`${notifyDedupe.count} + 1`})
      .where(eq(notifyDedupe.fingerprint, fingerprint));
  },
};

setNotifyDedupeStore(pgDedupeStore);
