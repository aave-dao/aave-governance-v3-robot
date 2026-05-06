'use client';

import { Check, Loader2, AlertCircle, Clock, ExternalLink, User } from 'lucide-react';
import { txExplorerUrl, addressExplorerUrl } from '@/lib/explorer-client';
import { cn } from './ui/cn';

export type ExecutionRow = {
  id: string;
  action: string;
  proposalId: string | null;
  chainId: number;
  payloadId: number | null;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  txHash: string | null;
  error: string | null;
  requestedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

const ICON: Record<ExecutionRow['status'], React.ReactNode> = {
  pending: <Clock size={11} strokeWidth={2.5} />,
  submitted: <Loader2 size={11} strokeWidth={2.5} className="animate-spin" />,
  confirmed: <Check size={11} strokeWidth={2.5} />,
  failed: <AlertCircle size={11} strokeWidth={2.5} />,
};
const TONE: Record<ExecutionRow['status'], string> = {
  pending: 'border-warn-border bg-warn-bg text-warn',
  submitted: 'border-accent-border bg-accent-bg text-accent',
  confirmed: 'border-success-border bg-success-bg text-success',
  failed: 'border-danger-border bg-danger-bg text-danger',
};

const short = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const isAddressLike = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);

const fmtAge = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toISOString().slice(0, 16).replace('T', ' ') + 'Z';
  } catch {
    return iso;
  }
};

export function ExecutionList({ executions }: { executions: ExecutionRow[] }) {
  if (executions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-5 py-6 text-center text-[12px] text-fg-dim italic">
        No on-chain action triggered from this UI yet.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="hidden sm:grid grid-cols-[1fr_110px_120px_180px_140px_140px] gap-3 border-b border-border bg-surface-elev/50 px-4 sm:px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.06em] text-fg-dim">
        <div>Action</div>
        <div>Status</div>
        <div>Chain</div>
        <div>Tx</div>
        <div>By</div>
        <div className="text-right">When</div>
      </div>
      {executions.map((e) => {
        const url = e.txHash ? txExplorerUrl(e.chainId, e.txHash) : null;
        const byUrl =
          e.requestedBy && isAddressLike(e.requestedBy)
            ? addressExplorerUrl(e.chainId, e.requestedBy)
            : null;
        return (
          <div
            key={e.id}
            className="flex flex-col gap-1.5 border-b border-border px-4 sm:px-5 py-3 text-[12px] last:border-b-0 sm:grid sm:grid-cols-[1fr_110px_120px_180px_140px_140px] sm:items-center sm:gap-3"
          >
            <div className="font-mono font-semibold text-fg">{e.action}</div>
            <div>
              <span
                className={cn(
                  'inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium uppercase tracking-[0.04em] font-mono',
                  TONE[e.status],
                )}
              >
                {ICON[e.status]}
                {e.status}
              </span>
            </div>
            <div className="font-mono text-fg-dim">chain {e.chainId}</div>
            <div className="font-mono text-fg truncate">
              {e.txHash ? (
                url ? (
                  <a
                    className="inline-flex items-center gap-1 hover:text-accent"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(e.txHash)}
                    <ExternalLink size={10} strokeWidth={2.25} className="opacity-60" />
                  </a>
                ) : (
                  short(e.txHash)
                )
              ) : (
                <span className="text-fg-dim">{e.error?.slice(0, 60) ?? '—'}</span>
              )}
            </div>
            <div className="font-mono text-fg-dim truncate">
              {e.requestedBy ? (
                isAddressLike(e.requestedBy) && byUrl ? (
                  <a
                    href={byUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-accent"
                  >
                    <User size={10} strokeWidth={2.25} className="opacity-60" />
                    {shortAddr(e.requestedBy)}
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <User size={10} strokeWidth={2.25} className="opacity-60" />
                    {e.requestedBy.length > 18 ? `${e.requestedBy.slice(0, 16)}…` : e.requestedBy}
                  </span>
                )
              ) : (
                <span className="opacity-60">—</span>
              )}
            </div>
            <div
              className="font-mono text-fg-dim sm:text-right truncate"
              suppressHydrationWarning
            >
              {fmtAge(e.createdAt)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
