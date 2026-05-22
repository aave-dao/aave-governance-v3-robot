-- Materialize the UI-facing state label so server-side state filtering is a trivial
-- WHERE clause rather than a CASE expression that has to join the payloads table.
--
-- displayState = stateName for non-Executed proposals.
-- displayState = 'Executing' when L1 is Executed but at least one payload is non-terminal.
-- displayState = stateName ('Executed') when L1 is Executed AND all payloads are terminal.
--
-- Computed at upsert in `upsertReport()`. The backfill UPDATE here sets it to
-- state_name as a close-enough default — the only mismatch is "Executed-with-payload-
-- still-running" rows, and those are in the top-20 refresh window and will be corrected
-- on the next cron tick.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS display_state text;
UPDATE proposals SET display_state = state_name WHERE display_state IS NULL;
ALTER TABLE proposals ALTER COLUMN display_state SET NOT NULL;
CREATE INDEX IF NOT EXISTS proposals_display_state_idx ON proposals(display_state);
