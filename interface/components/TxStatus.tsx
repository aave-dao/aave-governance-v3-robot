'use client';

import useSWR from 'swr';
import { txExplorerUrl } from '@/lib/explorer-client';

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

export function TxStatus({ executionId }: { executionId: string }) {
  const { data } = useSWR<{ execution: ExecutionRow }>(`/api/execute/${executionId}`, fetcher, {
    refreshInterval: (latest) =>
      latest && isTerminal(latest.execution.status) ? 0 : 3000,
  });
  const exec = data?.execution;
  if (!exec) {
    return <span className="tx-status pending">submitting…</span>;
  }
  const url = exec.txHash ? txExplorerUrl(exec.chainId, exec.txHash) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className={`tx-status ${exec.status}`}>
        {exec.action}: {exec.status}
        {exec.txHash && (
          <>
            {' '}
            ·{' '}
            {url ? (
              <a href={url} target="_blank" rel="noreferrer">{shortHash(exec.txHash)}</a>
            ) : (
              <span>{shortHash(exec.txHash)}</span>
            )}
          </>
        )}
      </span>
      {exec.error && (
        <span className="action-reason" style={{ color: 'var(--red)' }}>{exec.error}</span>
      )}
    </div>
  );
}

const shortHash = (h: string) => (h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);
