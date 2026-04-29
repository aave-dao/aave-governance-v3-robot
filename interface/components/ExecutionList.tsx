'use client';

import { Check, Loader2, AlertCircle, Clock, ExternalLink } from 'lucide-react';
import { txExplorerUrl } from '@/lib/explorer-client';
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
      {executions.map((e) => {
        const url = e.txHash ? txExplorerUrl(e.chainId, e.txHash) : null;
        return (
          <div
            key={e.id}
            className="grid grid-cols-[1fr_120px_80px_220px] items-center gap-4 border-b border-border px-5 py-3 text-[12px] last:border-b-0"
          >
            <div className="font-mono text-fg">{e.action}</div>
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
          </div>
        );
      })}
    </div>
  );
}
