// Report per-table footprint on the DATABASE_URL Postgres instance.
//
// Usage:  bun run scripts/db-status.ts
//
// What it prints (one row per user table, sorted by total size):
//   - rows           live row count from pg_stat_user_tables (estimate; ANALYZE refreshes)
//   - dead           dead tuples awaiting vacuum (DELETE leaves these behind; high values
//                    mean the table file is bloated and a VACUUM FULL would shrink it)
//   - cols           column count from information_schema
//   - heap           pg_relation_size — the main table heap on disk
//   - indexes        sum of all index sizes for the table
//   - toast          out-of-line storage for large jsonb/text values (eligibility / raw / summary)
//   - total          heap + indexes + toast (pg_total_relation_size)
//
// Note on space reclaim:
//   - DROP TABLE       — frees disk immediately.
//   - TRUNCATE         — frees disk immediately (recreates the file).
//   - DELETE FROM …    — marks rows dead but does NOT shrink the file. Run VACUUM FULL to
//                        compact, or autovacuum will gradually reuse the space for new rows.
//
// If you ran a DELETE on cron_runs and the file size is still huge, that's why — DELETE alone
// doesn't return bytes to the OS.

import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const sql = postgres(url, { max: 1, prepare: false });

const formatBytes = (n: number | bigint): string => {
  const v = Number(n);
  if (v < 1024) return `${v} B`;
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${(v / 1024 ** 3).toFixed(2)} GB`;
};

const formatRows = (n: number | bigint): string => {
  const v = Number(n);
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1_000).toFixed(1)}k`;
  return `${(v / 1_000_000).toFixed(2)}M`;
};

const pad = (s: string, n: number, left = false) =>
  left ? s.padStart(n) : s.padEnd(n);

type RawRow = {
  name: string;
  rows: string;
  dead: string;
  cols: number;
  heap: string;
  indexes: string;
  toast: string;
  total: string;
};

type Row = {
  name: string;
  rows: bigint;
  dead: bigint;
  cols: number;
  heap: bigint;
  indexes: bigint;
  toast: bigint;
  total: bigint;
};

// postgres.js returns int8 as JS number or BigInt depending on driver build / column type
// inference — coercing everything through `BigInt(String(...))` is the only shape that
// reliably preserves precision across drivers without overflow.
const toBig = (v: unknown): bigint => BigInt(String(v ?? 0));

try {
  // Includes orphan toast tables only via the parent's total_relation_size, so we don't
  // double-count them here. Every numeric is cast to text in SQL so the driver hands us
  // strings, which we then parse to BigInt on the JS side.
  const raw = (await sql<RawRow[]>`
    SELECT
      c.relname::text                                                AS name,
      COALESCE(s.n_live_tup, 0)::bigint::text                        AS rows,
      COALESCE(s.n_dead_tup, 0)::bigint::text                        AS dead,
      (
        SELECT COUNT(*)::int
        FROM information_schema.columns
        WHERE table_schema = n.nspname AND table_name = c.relname
      )                                                              AS cols,
      pg_relation_size(c.oid)::bigint::text                          AS heap,
      pg_indexes_size(c.oid)::bigint::text                           AS indexes,
      COALESCE(pg_relation_size(c.reltoastrelid), 0)::bigint::text   AS toast,
      pg_total_relation_size(c.oid)::bigint::text                    AS total
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY pg_total_relation_size(c.oid) DESC;
  `);

  const rows: Row[] = raw.map((r) => ({
    name: r.name,
    rows: toBig(r.rows),
    dead: toBig(r.dead),
    cols: Number(r.cols),
    heap: toBig(r.heap),
    indexes: toBig(r.indexes),
    toast: toBig(r.toast),
    total: toBig(r.total),
  }));

  const totalBytes = rows.reduce((a, r) => a + r.total, 0n);
  const totalRows = rows.reduce((a, r) => a + r.rows, 0n);
  const totalDead = rows.reduce((a, r) => a + r.dead, 0n);

  const header =
    `${pad('table', 28)}  ${pad('rows', 8, true)}  ${pad('dead', 8, true)}  ${pad('cols', 5, true)}  ` +
    `${pad('heap', 10, true)}  ${pad('indexes', 10, true)}  ${pad('toast', 10, true)}  ${pad('TOTAL', 10, true)}`;
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of rows) {
    console.log(
      `${pad(r.name, 28)}  ${pad(formatRows(r.rows), 8, true)}  ${pad(formatRows(r.dead), 8, true)}  ` +
      `${pad(String(r.cols), 5, true)}  ${pad(formatBytes(r.heap), 10, true)}  ${pad(formatBytes(r.indexes), 10, true)}  ` +
      `${pad(formatBytes(r.toast), 10, true)}  ${pad(formatBytes(r.total), 10, true)}`,
    );
  }
  console.log('-'.repeat(header.length));
  console.log(
    `${pad('SUM', 28)}  ${pad(formatRows(totalRows), 8, true)}  ${pad(formatRows(totalDead), 8, true)}  ${pad('', 5)}  ` +
    `${pad('', 10)}  ${pad('', 10)}  ${pad('', 10)}  ${pad(formatBytes(totalBytes), 10, true)}`,
  );

  // Flag tables where dead tuples are >25% of live rows — these would shrink under VACUUM FULL.
  const bloated = rows.filter((r) => r.rows > 0n && r.dead * 4n > r.rows);
  if (bloated.length > 0) {
    console.log('');
    console.log('⚠ Tables with >25% dead tuples (consider VACUUM FULL to reclaim disk):');
    for (const r of bloated) {
      console.log(`  • ${r.name}: ${formatRows(r.dead)} dead vs ${formatRows(r.rows)} live`);
    }
  }

  // Surface a DB-wide size from pg_database for sanity-check vs sum-of-tables (the diff is
  // catalog tables + WAL + transient stuff).
  const dbSizeRows = await sql<{ db_size: string }[]>`
    SELECT pg_database_size(current_database())::bigint::text AS db_size;
  `;
  console.log('');
  console.log(
    `pg_database_size: ${formatBytes(toBig(dbSizeRows[0]!.db_size))} (includes catalogs + non-user-table overhead)`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
