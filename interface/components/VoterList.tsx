'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { fmtCompactAave } from '@/lib/format';
import { addressExplorerUrl } from '@/lib/explorer-client';
import { cn } from './ui/cn';
import { Button } from './ui/Button';

export type VoteRow = {
  proposalId: string;
  votingChainId: number;
  voter: string;
  support: boolean;
  votingPower: string;
  txHash: string;
  blockNumber: string;
  logIndex: number;
  ensName?: string | null;
};

const INITIAL_ROWS = 8;

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** Deterministic two-color gradient avatar from an Ethereum address. */
const avatarGradient = (addr: string): string => {
  const hex = addr.replace(/^0x/, '');
  const h1 = parseInt(hex.slice(0, 6), 16) % 360;
  const h2 = parseInt(hex.slice(6, 12), 16) % 360;
  return `linear-gradient(135deg, hsl(${h1} 70% 55%) 0%, hsl(${h2} 70% 45%) 100%)`;
};

export function VoterList({ votes, ens }: { votes: VoteRow[]; ens?: Record<string, string | null> }) {
  const [showAll, setShowAll] = useState(false);

  if (votes.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-5 py-8 text-center text-[13px] text-fg-muted italic">
        No votes recorded yet.
      </div>
    );
  }

  const sorted = [...votes].sort((a, b) => {
    const pa = BigInt(a.votingPower);
    const pb = BigInt(b.votingPower);
    if (pa === pb) return 0;
    return pa > pb ? -1 : 1;
  });

  const total = sorted.reduce((acc, v) => acc + BigInt(v.votingPower), 0n);
  const visible = showAll ? sorted : sorted.slice(0, INITIAL_ROWS);

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="grid grid-cols-[1fr_140px_84px] sm:grid-cols-[1fr_180px_90px] gap-3 sm:gap-4 border-b border-border bg-surface-elev/50 px-4 sm:px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.06em] text-fg-dim">
        <div>Voter</div>
        <div>Voting power</div>
        <div className="text-right">Support</div>
      </div>
      <div className={cn(showAll && 'max-h-[420px] overflow-y-auto')}>
      {visible.map((v) => {
        const ensName = v.ensName ?? ens?.[v.voter.toLowerCase()] ?? null;
        const url = addressExplorerUrl(v.votingChainId, v.voter);
        const power = BigInt(v.votingPower);
        const sharePct = total > 0n ? Number((power * 10000n) / total) / 100 : 0;
        return (
          <div
            key={`${v.txHash}-${v.logIndex}`}
            className="grid grid-cols-[1fr_140px_84px] sm:grid-cols-[1fr_180px_90px] items-center gap-3 sm:gap-4 border-b border-border px-4 sm:px-5 py-3 last:border-b-0 hover:bg-surface-elev/40"
          >
            <a
              href={url ?? '#'}
              target={url ? '_blank' : undefined}
              rel={url ? 'noreferrer' : undefined}
              className="flex items-center gap-2.5 min-w-0"
            >
              <span
                className="h-6 w-6 shrink-0 rounded-full"
                style={{ background: avatarGradient(v.voter) }}
                aria-hidden
              />
              <span className="flex flex-col min-w-0">
                {ensName ? (
                  <>
                    <span className="truncate text-[13px] font-semibold text-fg">{ensName}</span>
                    <span className="truncate font-mono text-[11px] text-fg-dim">
                      {short(v.voter)}
                    </span>
                  </>
                ) : (
                  <span className="truncate font-mono text-[12px] text-fg-muted">
                    {short(v.voter)}
                  </span>
                )}
              </span>
            </a>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[12px] tabular-nums text-fg">
                {fmtCompactAave(power)}
              </span>
              <span className="relative h-1 overflow-hidden rounded-full bg-surface-elev">
                <span
                  className={cn(
                    'absolute inset-y-0 left-0',
                    v.support ? 'bg-for' : 'bg-against',
                  )}
                  style={{ width: `${Math.max(sharePct, 1.5)}%` }}
                />
              </span>
            </div>
            <div className="flex items-center justify-end">
              <span
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium uppercase tracking-[0.04em] font-mono',
                  v.support
                    ? 'border-success-border bg-success-bg text-success'
                    : 'border-danger-border bg-danger-bg text-danger',
                )}
              >
                {v.support ? <Check size={10} strokeWidth={2.5} /> : <X size={10} strokeWidth={2.5} />}
                {v.support ? 'For' : 'Against'}
              </span>
            </div>
          </div>
        );
      })}
      </div>
      {sorted.length > INITIAL_ROWS && (
        <div className="border-t border-border bg-surface-elev/30 px-5 py-2.5 text-center">
          <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer' : `Show all ${sorted.length}`}
          </Button>
        </div>
      )}
    </div>
  );
}
