-- Cache for on-chain lifecycle event tx hashes (L1 governance, L2 voting machine,
-- per-execution-chain payload events). Populated by the indexer in `lib/lifecycle-index.ts`
-- during cache-refresh / inspectAndCacheProposal so the UI never has to scan logs at
-- request time.
--
-- payload_id is non-null with a -1 sentinel for non-payload kinds (L1 + L2 voting), so the
-- composite unique key works without NULL-distinct semantics.
CREATE TABLE IF NOT EXISTS "lifecycle_txs" (
  "proposal_id" bigint NOT NULL,
  "kind" text NOT NULL,
  "chain_id" integer NOT NULL,
  "payload_id" integer NOT NULL DEFAULT -1,
  "tx_hash" text NOT NULL,
  "block_number" bigint NOT NULL,
  "log_index" integer NOT NULL,
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "lifecycle_txs_pk"
  ON "lifecycle_txs" ("proposal_id", "kind", "chain_id", "payload_id");
CREATE INDEX IF NOT EXISTS "lifecycle_txs_proposal_idx"
  ON "lifecycle_txs" ("proposal_id");
