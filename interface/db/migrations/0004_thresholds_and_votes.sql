ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "yes_threshold" text,
  ADD COLUMN IF NOT EXISTS "yes_no_differential" text,
  ADD COLUMN IF NOT EXISTS "votes_synced_to_block" bigint;

CREATE TABLE IF NOT EXISTS "votes" (
  "proposal_id" bigint NOT NULL,
  "voting_chain_id" integer NOT NULL,
  "voter" text NOT NULL,
  "support" boolean NOT NULL,
  "voting_power" text NOT NULL,
  "tx_hash" text NOT NULL,
  "block_number" bigint NOT NULL,
  "log_index" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "votes_pk" ON "votes" ("proposal_id", "voting_chain_id", "tx_hash", "log_index");
CREATE INDEX IF NOT EXISTS "votes_proposal_idx" ON "votes" ("proposal_id");
