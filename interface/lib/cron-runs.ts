import { db } from '@/db/client';
import { cronRuns } from '@/db/schema';
import { ulid } from './ulid';
import { jsonSafe } from './serialize';

type RecordParams = {
  name: string;
  ok: boolean;
  durationMs: number;
  summary?: unknown;
  error?: string;
};

export const recordCronRun = async ({ name, ok, durationMs, summary, error }: RecordParams) => {
  await db.insert(cronRuns).values({
    id: ulid(),
    name,
    ok,
    durationMs,
    finishedAt: new Date(),
    summary: summary === undefined ? null : (jsonSafe(summary) as unknown as object),
    error: error ?? null,
  });
};
