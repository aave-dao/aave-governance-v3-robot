'use client';

import { txExplorerUrl } from '@/lib/explorer-client';

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

export function ExecutionList({ executions }: { executions: ExecutionRow[] }) {
  if (executions.length === 0) {
    return <p className="empty">No executions yet for this proposal.</p>;
  }
  return (
    <div className="card" style={{ padding: 0 }}>
      {executions.map((e) => {
        const url = e.txHash ? txExplorerUrl(e.chainId, e.txHash) : null;
        return (
          <div key={e.id} className="exec-row">
            <div>{e.action}</div>
            <div>
              <span className={`tx-status ${e.status}`}>{e.status}</span>
            </div>
            <div className="dim">chain {e.chainId}</div>
            <div>
              {e.txHash ? (
                url ? (
                  <a href={url} target="_blank" rel="noreferrer">
                    {short(e.txHash)}
                  </a>
                ) : (
                  short(e.txHash)
                )
              ) : (
                <span className="dim">{e.error?.slice(0, 80) ?? '—'}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const short = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);
