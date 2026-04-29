'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { StateBadge } from './StateBadge';
import { displayStateName } from '@/lib/display-state';
import { fmtDate } from '@/lib/format';
import type { EligibilityBlob } from '@/db/schema';

export type ProposalRow = {
  id: string;
  state: number;
  stateName: string;
  creator: string;
  creationTime: number;
  metadata: { title?: string } | null;
  eligibility: EligibilityBlob;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ProposalList({ initial }: { initial: ProposalRow[] }) {
  const { data } = useSWR<{ proposals: ProposalRow[] }>('/api/proposals', fetcher, {
    fallbackData: { proposals: initial },
    refreshInterval: 30_000,
    keepPreviousData: true,
    revalidateOnFocus: false,
  });
  const rows = data?.proposals ?? initial;
  if (rows.length === 0) {
    return (
      <p className="empty">
        No proposals cached yet — the cache-refresh cron populates them every minute.
      </p>
    );
  }
  return (
    <div className="proposal-list">
      {rows.map((p) => {
        const display = displayStateName(p.state, p.stateName, p.eligibility?.payloads);
        return (
          <Link key={p.id} href={`/proposal/${p.id}`} className="proposal-row">
            <div className="id">#{p.id}</div>
            <div className="title">
              {p.metadata?.title ?? <span className="empty">(no metadata yet)</span>}
            </div>
            <div className="meta" suppressHydrationWarning>
              {fmtDate(p.creationTime)}
            </div>
            <StateBadge state={display} />
          </Link>
        );
      })}
    </div>
  );
}
