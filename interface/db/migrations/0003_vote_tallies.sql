ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "for_votes" text,
  ADD COLUMN IF NOT EXISTS "against_votes" text,
  ADD COLUMN IF NOT EXISTS "vm_for_votes" text,
  ADD COLUMN IF NOT EXISTS "vm_against_votes" text,
  ADD COLUMN IF NOT EXISTS "vm_state_name" text;
