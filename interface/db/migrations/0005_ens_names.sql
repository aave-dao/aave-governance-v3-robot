CREATE TABLE IF NOT EXISTS "ens_names" (
  "address" text PRIMARY KEY NOT NULL,
  "name" text,
  "resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "ens_names_expires_idx" ON "ens_names" ("expires_at");
