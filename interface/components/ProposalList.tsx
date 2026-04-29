'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Inbox, Loader2, Zap, Clock, Check, X as XIcon, AlertCircle } from 'lucide-react';
import useSWRInfinite from 'swr/infinite';
import { displayStateName } from '@/lib/display-state';
import { nextActionLabel, pickVoteSource, type NextAction } from '@/lib/eta';
import { useNow } from '@/lib/use-now';
import type { EligibilityBlob } from '@/db/schema';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { StateBadge } from './StateBadge';
import { VoteBar } from './VoteBar';
import { ProposalFilters, type FilterState, useFilterState } from './ProposalFilters';
import { ProposalListSkeleton } from './skeletons/ProposalListSkeleton';
import { cn } from './ui/cn';

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
  const [filters, setFilters] = useFilterState();

  const { data, size, setSize, isValidating, isLoading } = useSWRInfinite<Page>(
    (index, prev) => {
      if (prev && prev.nextCursor === null) return null;
      if (index === 0) return `/api/proposals?limit=${PAGE_SIZE}`;
      return `/api/proposals?limit=${PAGE_SIZE}&cursor=${prev!.nextCursor}`;
    },
    fetcher,
    {
      fallbackData: [
        {
          proposals: initial,
          nextCursor:
            initial.length === PAGE_SIZE ? initial[initial.length - 1]!.id : null,
        },
      ],
      refreshInterval: 30_000,
      revalidateOnFocus: false,
      keepPreviousData: true,
      revalidateFirstPage: true,
    },
  );

  const pages = data ?? [];
  const allRows = pages.flatMap((p) => p.proposals);
  const filtered = useMemo(() => filterProposals(allRows, filters), [allRows, filters]);
  const lastPage = pages[pages.length - 1];
  const canLoadMore = !!lastPage && lastPage.nextCursor !== null;

  // Pick the smallest upcoming `nextEventAt` so the live clock ticks with the right cadence.
  const nextEventAt = useMemo(() => {
    let earliest: number | undefined;
    for (const p of filtered) {
      const next = nextActionLabel(p);
      if (next.nextEventAt && (!earliest || next.nextEventAt < earliest)) {
        earliest = next.nextEventAt;
      }
    }
    return earliest ?? null;
  }, [filtered]);
  const now = useNow(nextEventAt);

  if (isLoading && allRows.length === 0) {
    return <ProposalListSkeleton />;
  }

  return (
    <div className="flex flex-col gap-4">
      <ProposalFilters
        value={filters}
        onChange={setFilters}
        total={allRows.length}
        showing={filtered.length}
      />

      {filtered.length === 0 ? (
        <EmptyState onClear={() => setFilters({ q: '', states: [] })} />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((p) => (
            <ProposalRowCard key={p.id} p={p} now={now} />
          ))}
        </div>
      )}

      {canLoadMore && filtered.length > 0 && (
        <div className="flex justify-center pt-2">
          <Button
            variant="default"
            size="md"
            disabled={isValidating}
            leftIcon={isValidating ? <Loader2 size={14} className="animate-spin" /> : null}
            onClick={() => setSize(size + 1)}
          >
            {isValidating ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}

const TONE_BAR: Record<NextAction['tone'], string> = {
  pending: 'bg-accent',
  ready: 'bg-success',
  final: 'bg-fg-dim',
  failed: 'bg-danger',
};
const TONE_TEXT: Record<NextAction['tone'], string> = {
  pending: 'text-accent',
  ready: 'text-success',
  final: 'text-fg-muted',
  failed: 'text-danger',
};

const TONE_ICON: Record<NextAction['tone'], React.ReactNode> = {
  pending: <Clock size={12} strokeWidth={2.5} />,
  ready: <Zap size={12} strokeWidth={2.5} />,
  final: <Check size={12} strokeWidth={2.5} />,
  failed: <XIcon size={12} strokeWidth={2.5} />,
};

function ProposalRowCard({ p, now }: { p: ProposalRow; now: number }) {
  const display = displayStateName(p.state, p.stateName, p.eligibility?.payloads);
  const next = nextActionLabel(p, now);
  const votes = pickVoteSource(p);
  return (
    <Link href={`/proposal/${p.id}`} className="block">
      <Card
        interactive
        className="relative flex flex-col gap-4 px-4 py-4 sm:px-5 lg:grid lg:grid-cols-[80px_minmax(0,1fr)_240px_220px_120px] lg:items-center lg:gap-5"
      >
        <span
          className={cn(
            'absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full',
            TONE_BAR[next.tone],
          )}
          aria-hidden
        />

        {/* Top row on mobile/tablet: id + state badge.
            On desktop these split apart into separate grid cells. */}
        <div className="flex items-center justify-between lg:contents">
          <div className="font-mono text-[13px] tabular-nums text-fg-dim lg:order-1">#{p.id}</div>
          <div className="flex justify-end lg:order-5">
            <StateBadge state={display} />
          </div>
        </div>

        {/* Title block */}
        <div className="min-w-0 lg:order-2">
          <div className="line-clamp-2 lg:truncate text-[15px] font-semibold leading-tight tracking-tight">
            {p.metadata?.title ?? <span className="italic text-fg-dim">(no metadata yet)</span>}
          </div>
          <div className="mt-1 text-[12px] text-fg-dim font-mono tabular-nums">
            {new Date(p.creationTime * 1000).toISOString().slice(0, 10)}
          </div>
        </div>

        {/* Votes */}
        <div className="min-w-0 lg:order-3">
          <VoteBar snapshot={votes} variant="compact" />
        </div>

        {/* ETA pill */}
        <div className="flex items-center gap-1.5 min-w-0 lg:order-4">
          <span className={cn('shrink-0', TONE_TEXT[next.tone])}>{TONE_ICON[next.tone]}</span>
          <span
            className={cn('truncate text-[12px] font-medium', TONE_TEXT[next.tone])}
            suppressHydrationWarning
          >
            {next.label}
          </span>
        </div>
      </Card>
    </Link>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-elev text-fg-dim">
        <Inbox size={18} />
      </span>
      <div className="space-y-1">
        <div className="text-[15px] font-semibold">No proposals match these filters</div>
        <div className="text-[13px] text-fg-muted">Try widening the search or clearing chips.</div>
      </div>
      <Button variant="default" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </Card>
  );
}

function filterProposals(rows: ProposalRow[], filters: FilterState): ProposalRow[] {
  const q = filters.q.trim().toLowerCase();
  const stateSet = new Set(filters.states.map((s) => s.toLowerCase()));
  return rows.filter((p) => {
    if (stateSet.size > 0) {
      const display = displayStateName(p.state, p.stateName, p.eligibility?.payloads).toLowerCase();
      if (!stateSet.has(display)) return false;
    }
    if (!q) return true;
    if (p.id.includes(q)) return true;
    if (p.metadata?.title?.toLowerCase().includes(q)) return true;
    if (p.creator.toLowerCase().includes(q)) return true;
    return false;
  });
}

// AlertCircle import keeps lint happy when used in skeletons module if we re-export later.
void AlertCircle;
