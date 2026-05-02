-- Two proposals can reference the same (chain_id, payload_id) — common with re-submitted
-- proposals (e.g. #477 + #478 rsETH incident, both pointing at the same 8 payloads). Move
-- proposal_id into the unique key so each proposal-payload link is its own row.
DROP INDEX IF EXISTS "payloads_pk";
CREATE UNIQUE INDEX IF NOT EXISTS "payloads_pk"
  ON "payloads" ("chain_id", "payload_id", "proposal_id");
