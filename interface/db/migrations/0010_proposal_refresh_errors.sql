-- Per-proposal refresh error tracking. Without this, an inspector failure on a single
-- proposal (RPC blip, JSONB constraint violation, etc.) lands in cron_runs.summary.errors
-- and nothing surfaces it — the proposal's row stays frozen forever. The #486 incident
-- (Active for a day after voting actually finished) was exactly this failure mode.
--
-- `last_error` carries the most recent failure reason (truncated by the writer); `last_error_at`
-- is the timestamp of that failure. On a successful upsertReport, both columns are cleared
-- by the upsert's ON CONFLICT DO UPDATE set-clause.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS last_error_at timestamp with time zone;
