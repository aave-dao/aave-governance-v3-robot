'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from './ui/Input';
import { cn } from './ui/cn';

export type FilterState = {
  q: string;
  states: string[];
};

const STATE_OPTIONS = [
  'Active',
  'Executing',
  'Queued',
  'Executed',
  'Failed',
  'Cancelled',
  'Expired',
] as const;

/**
 * Hook: keep filter state synced with URL query (`?q=foo&state=active,queued`) so back/forward
 * + bookmarking work as expected.
 */
export function useFilterState(): [FilterState, (next: FilterState) => void] {
  const router = useRouter();
  const params = useSearchParams();

  const value: FilterState = {
    q: params.get('q') ?? '',
    states: (params.get('state') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };

  const setValue = useCallback(
    (next: FilterState) => {
      const search = new URLSearchParams();
      if (next.q) search.set('q', next.q);
      if (next.states.length > 0) search.set('state', next.states.join(','));
      const qs = search.toString();
      router.replace(qs ? `/?${qs}` : '/', { scroll: false });
    },
    [router],
  );

  return [value, setValue];
}

type Props = {
  value: FilterState;
  onChange: (v: FilterState) => void;
  total: number;
  showing: number;
};

export function ProposalFilters({ value, onChange, total, showing }: Props) {
  const toggleState = (s: string) => {
    const set = new Set(value.states);
    if (set.has(s)) set.delete(s);
    else set.add(s);
    onChange({ ...value, states: [...set] });
  };

  const isFiltered = value.q.length > 0 || value.states.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 max-w-sm">
          <Input
            leftIcon={<Search size={14} />}
            placeholder="Search by id, title, or creator…"
            value={value.q}
            onChange={(e) => onChange({ ...value, q: e.currentTarget.value })}
            onClear={() => onChange({ ...value, q: '' })}
          />
        </div>
        <div className="text-[12px] font-mono text-fg-dim ml-auto" suppressHydrationWarning>
          {isFiltered ? `${showing} of ${total}` : `${total} cached`}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STATE_OPTIONS.map((s) => {
          const active = value.states.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleState(s)}
              className={cn(
                'h-7 rounded-full border px-3 text-[11px] font-medium uppercase tracking-[0.04em] transition-colors',
                active
                  ? 'border-accent-border bg-accent-bg text-accent'
                  : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg',
              )}
            >
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}
