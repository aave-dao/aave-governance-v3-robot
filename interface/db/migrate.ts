// Lightweight migrator: applies every .sql file in db/migrations/ in alphabetical order.
// Idempotent because each migration uses CREATE TABLE/INDEX IF NOT EXISTS.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const dir = path.join(__dirname, 'migrations');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const sql = postgres(url, { max: 1, prepare: false });

try {
  for (const f of files) {
    const body = fs.readFileSync(path.join(dir, f), 'utf8');
    process.stdout.write(`applying ${f}…`);
    await sql.unsafe(body);
    process.stdout.write(' ok\n');
  }
} finally {
  await sql.end({ timeout: 5 });
}
