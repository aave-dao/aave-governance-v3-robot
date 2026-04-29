'use client';

import { ExternalLink, Loader2, Check, AlertCircle } from 'lucide-react';
import useSWR from 'swr';
import { txExplorerUrl } from '@/lib/explorer-client';
import { cn } from './ui/cn';

type ExecutionStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

type ExecutionRow = {
  id: string;
  action: string;
  chainId: number;
  status: ExecutionStatus;
  txHash: string | null;
  error: string | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const isTerminal = (s: ExecutionStatus) => s === 'confirmed' || s === 'failed';

const TONE: Record<ExecutionStatus, string> = {
  pending: 'border-warn-border bg-warn-bg text-warn',
  submitted: 'border-accent-border bg-accent-bg text-accent',
  confirmed: 'border-success-border bg-success-bg text-success',
  failed: 'border-danger-border bg-danger-bg text-danger',
};

const ICON: Record<ExecutionStatus, React.ReactNode> = {
  pending: <Loader2 size={11} strokeWidth={2.5} className="animate-spin" />,
  submitted: <Loader2 size={11} strokeWidth={2.5} className="animate-spin" />,
  confirmed: <Check size={11} strokeWidth={2.5} />,
  failed: <AlertCircle size={11} strokeWidth={2.5} />,
};

const shortHash = (h: string) => (h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);

export function TxStatus({ executionId }: { executionId: string }) {
  const { data } = useSWR<{ execution: ExecutionRow }>(`/api/execute/${executionId}`, fetcher, {
    refreshInterval: (latest) =>
      latest && isTerminal(latest.execution.status) ? 0 : 3000,
  });
  const exec = data?.execution;
  if (!exec) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-warn-border bg-warn-bg px-2 py-1 font-mono text-[11px] text-warn">
        <Loader2 size={11} strokeWidth={2.5} className="animate-spin" />
        submitting…
      </span>
    );
  }
  const url = exec.txHash ? txExplorerUrl(exec.chainId, exec.txHash) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] capitalize',
          TONE[exec.status],
        )}
      >
        {ICON[exec.status]}
        {exec.status}
        {exec.txHash && (
          <>
            <span className="text-fg-dim">·</span>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                {shortHash(exec.txHash)}
                <ExternalLink size={9} strokeWidth={2.25} className="opacity-60" />
              </a>
            ) : (
              <span>{shortHash(exec.txHash)}</span>
            )}
          </>
        )}
      </span>
      {exec.error && (
        <span className="text-[11px] font-mono text-danger leading-snug whitespace-pre-wrap break-words">
          {exec.error}
        </span>
      )}
    </div>
  );
}
