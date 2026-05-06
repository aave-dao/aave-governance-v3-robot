-- Cross-process dedupe for notifyError. Without this, every cron tick re-notifies on the
-- same persistent failure (RPC outage, payload that keeps reverting, etc.). The notify
-- module computes a stable fingerprint from {source, chainId, meta, firstLine(message)}
-- and skips the alert if it has been notified within the last 6 hours.
--
-- `count` tracks how many times the alert was suppressed since the last fire — useful for
-- "this has been failing 287 times in the last 6h" forensics, even though we don't surface
-- it in the message body today.
CREATE TABLE IF NOT EXISTS "notify_dedupe" (
  "fingerprint" text PRIMARY KEY,
  "source" text NOT NULL,
  "chain_id" integer,
  "last_notified_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_message" text NOT NULL,
  "count" integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS "notify_dedupe_last_notified_idx"
  ON "notify_dedupe" ("last_notified_at");
