ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "voting_duration" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cooldown_period" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cool_down_before_voting_start" integer NOT NULL DEFAULT 0;
