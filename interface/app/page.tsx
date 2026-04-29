import { desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { proposals } from '@/db/schema';
import { jsonSafe } from '@/lib/serialize';
import { ProposalList, type ProposalRow } from '@/components/ProposalList';
import { HomeStatusBar } from '@/components/HomeStatusBar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function loadInitial(): Promise<ProposalRow[]> {
  try {
    const rows = await db.select().from(proposals).orderBy(desc(proposals.id)).limit(20);
    return jsonSafe(rows) as ProposalRow[];
  } catch {
    // First-load before the cache cron has populated anything: render empty.
    return [];
  }
}

export default async function Home() {
  const initial = await loadInitial();
  return (
    <div className="flex flex-col gap-5">
      <HomeStatusBar />
      <ProposalList initial={initial} />
    </div>
  );
}
