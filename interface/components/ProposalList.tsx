'use client';

import Link from 'next/link';
import useSWRInfinite from 'swr/infinite';
import { StateBadge } from './StateBadge';
import { VoteBar } from './VoteBar';
import { displayStateName } from '@/lib/display-state';
import { nextActionLabel, pickVoteSource } from '@/lib/eta';
import type { EligibilityBlob } from '@/db/schema';

export type ProposalRow = {
  id: string;
  state: number;
  stateName: string;
  creator: string;
  creationTime: number;
  metadata: { title?: string } | null;
  eligibility: EligibilityBlob;
  forVotes: string | null;
  againstVotes: string | null;
  vmForVotes: string | null;
  vmAgainstVotes: string | null;
  vmStateName: string | null;
};

type Page = { proposals: ProposalRow[]; nextCursor: string | null };

const fetcher = (url: string): Promise<Page> => fetch(url).then((r) => r.json());

const PAGE_SIZE = 20;

export function ProposalList({ initial }: { initial: ProposalRow[] }) {
  const { data, size, setSize, isValidating } = useSWRInfinite<Page>(
    (index, prev) => {
      if (prev && prev.nextCursor === null) return null; // no more pages
      if (index === 0) return `/api/proposals?limit=${PAGE_SIZE}`;
      return `/api/proposals?limit=${PAGE_SIZE}&cursor=${prev!.nextCursor}`;
    },
    fetcher,
    {
      fallbackData: [{ proposals: initial, nextCursor: initial.length === PAGE_SIZE ? initial[initial.length - 1]!.id : null }],
      refreshInterval: 30_000,
      revalidateOnFocus: false,
      keepPreviousData: true,
      revalidateFirstPage: true,
    },
  );

  const pages = data ?? [];
  const rows = pages.flatMap((p) => p.proposals);
  const lastPage = pages[pages.length - 1];
  const canLoadMore = !!lastPage && lastPage.nextCursor !== null;

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
        const next = nextActionLabel(p);
        const votes = pickVoteSource(p);
        return (
          <Link key={p.id} href={`/proposal/${p.id}`} className="proposal-row">
            <div className="id">#{p.id}</div>
            <div className="title">
              {p.metadata?.title ?? <span className="empty">(no metadata yet)</span>}
            </div>
            <div className="vote-cell">
              <VoteBar snapshot={votes} variant="compact" />
            </div>
            <div className={`eta-cell tone-${next.tone}`} suppressHydrationWarning>
              {next.label}
            </div>
            <StateBadge state={display} />
          </Link>
        );
      })}
      {canLoadMore && (
        <button
          type="button"
          className="load-more"
          disabled={isValidating}
          onClick={() => setSize(size + 1)}
        >
          {isValidating ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
