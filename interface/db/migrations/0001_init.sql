CREATE TABLE IF NOT EXISTS "proposals" (
  "id" bigint PRIMARY KEY NOT NULL,
  "state" integer NOT NULL,
  "state_name" text NOT NULL,
  "creator" text NOT NULL,
  "creation_time" integer NOT NULL,
  "voting_activation_time" integer NOT NULL,
  "queuing_time" integer NOT NULL,
  "access_level" integer NOT NULL,
  "snapshot_block_hash" text NOT NULL,
  "ipfs_hash" text NOT NULL,
  "voting_portal" text NOT NULL,
  "metadata" jsonb,
  "metadata_error" text,
  "eligibility" jsonb NOT NULL,
  "next_recommended" jsonb,
  "raw" jsonb NOT NULL,
  "refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "proposals_state_idx" ON "proposals" ("state");
CREATE INDEX IF NOT EXISTS "proposals_refreshed_at_idx" ON "proposals" ("refreshed_at");

CREATE TABLE IF NOT EXISTS "payloads" (
  "chain_id" integer NOT NULL,
  "payload_id" integer NOT NULL,
  "proposal_id" bigint NOT NULL,
  "chain_name" text NOT NULL,
  "payloads_controller" text NOT NULL,
  "state" integer NOT NULL,
  "state_name" text NOT NULL,
  "action_count" integer NOT NULL,
  "queued_at" integer,
  "delay" integer,
  "executable" jsonb NOT NULL,
  "raw" jsonb,
  "refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "payloads_pk" ON "payloads" ("chain_id", "payload_id");
CREATE INDEX IF NOT EXISTS "payloads_proposal_idx" ON "payloads" ("proposal_id");
CREATE INDEX IF NOT EXISTS "payloads_refreshed_at_idx" ON "payloads" ("refreshed_at");

CREATE TABLE IF NOT EXISTS "executions" (
  "id" text PRIMARY KEY NOT NULL,
  "action" text NOT NULL,
  "proposal_id" bigint,
  "chain_id" integer NOT NULL,
  "payload_id" integer,
  "status" text NOT NULL,
  "tx_hash" text,
  "error" text,
  "requested_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "executions_proposal_idx" ON "executions" ("proposal_id");
CREATE INDEX IF NOT EXISTS "executions_status_idx" ON "executions" ("status");
CREATE INDEX IF NOT EXISTS "executions_created_at_idx" ON "executions" ("created_at");

CREATE TABLE IF NOT EXISTS "cron_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "ok" boolean,
  "duration_ms" integer,
  "summary" jsonb,
  "error" text
);

CREATE INDEX IF NOT EXISTS "cron_runs_name_started_idx" ON "cron_runs" ("name", "started_at");

CREATE TABLE IF NOT EXISTS "cursors" (
  "name" text PRIMARY KEY NOT NULL,
  "chain_id" integer NOT NULL,
  "last_block" bigint NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
