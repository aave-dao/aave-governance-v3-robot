// Tenderly Storage-backed implementation of `DedupeStore`. Each Tenderly Action invocation
// is a fresh process, so a Map-backed in-process store would dedupe nothing across cron
// ticks. The Tenderly Storage API persists across invocations within the same project.
//
// Storage key layout:
//   notify-dedupe:<fp>      → unix-seconds last_notified (number)
//   notify-dedupe-info:<fp> → {source, chainId, message} JSON, kept for forensics
//
// Tenderly's `getStr`/`getNumber` THROW when the key doesn't exist — we treat the throw
// as "absent" rather than a real failure.

import type {Storage} from '@tenderly/actions';
import {setNotifyDedupeStore, type DedupeStore} from '../core/notify';

const KEY_TS = (fp: string) => `notify-dedupe:${fp}`;
const KEY_INFO = (fp: string) => `notify-dedupe-info:${fp}`;
const KEY_COUNT = (fp: string) => `notify-dedupe-count:${fp}`;

const safeGet = async <T>(read: () => Promise<T>): Promise<T | null> => {
  try {
    return await read();
  } catch {
    // Tenderly Storage throws on missing keys — that's the "no record" case for us.
    return null;
  }
};

export const makeTenderlyDedupeStore = (storage: Storage): DedupeStore => ({
  async getLastNotified(fp) {
    const v = await safeGet(() => storage.getNumber(KEY_TS(fp)));
    if (v === null || v === 0 || Number.isNaN(v)) return null;
    return v;
  },

  async setLastNotified(fp, atSec, info) {
    await storage.putNumber(KEY_TS(fp), atSec);
    await storage.putJson(KEY_INFO(fp), {
      source: info.source,
      chainId: info.chainId ?? null,
      // Truncate to keep storage entries small.
      message: info.message.slice(0, 4_000),
    });
    // Reset suppressed-count on a fresh fire.
    await storage.putNumber(KEY_COUNT(fp), 1);
  },

  async bumpSuppressed(fp) {
    const cur = (await safeGet(() => storage.getNumber(KEY_COUNT(fp)))) ?? 0;
    await storage.putNumber(KEY_COUNT(fp), cur + 1);
  },
});

/** Install the dedupe store onto `notifyError`. Idempotent — safe to call per-invocation. */
export const installTenderlyNotifyDedupe = (storage: Storage): void => {
  setNotifyDedupeStore(makeTenderlyDedupeStore(storage));
};
