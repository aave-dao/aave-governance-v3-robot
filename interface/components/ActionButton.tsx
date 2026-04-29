'use client';

import { useState } from 'react';
import { fmtRelative } from '@/lib/format';
import { TxStatus } from './TxStatus';

type Eligibility = { eligible: boolean; reason?: string; etaAt?: number };

type Props = {
  action: string;
  /** proposalId for governance/voting actions, payloadId for executePayload (decimal string). */
  id: string;
  chainId: number;
  eligibility: Eligibility;
  destructive?: boolean;
};

const LABELS: Record<string, string> = {
  activateVoting: 'Activate voting',
  executeProposal: 'Execute proposal',
  cancelProposal: 'Cancel proposal',
  submitStorageRoots: 'Submit storage roots',
  createVote: 'Create vote',
  closeAndSendVote: 'Close & send vote',
  executePayload: 'Execute payload',
};

export function ActionButton({ action, id, chainId, eligibility, destructive }: Props) {
  const [busy, setBusy] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const confirmMsg = destructive
        ? `Send ${action} for ${id} on chainId ${chainId}? This is destructive.`
        : `Send ${action} for ${id} on chainId ${chainId}?`;
      if (!confirm(confirmMsg)) {
        setBusy(false);
        return;
      }
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, id, chainId }),
      });
      const json = (await res.json()) as { executionId?: string; error?: string };
      if (!res.ok || !json.executionId) {
        setError(json.error ?? `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      setExecutionId(json.executionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (executionId) {
    return <TxStatus executionId={executionId} />;
  }

  const cls = `action-button ${eligibility.eligible ? 'eligible' : ''}`.trim();
  return (
    <div>
      <button
        type="button"
        className={cls}
        disabled={!eligibility.eligible || busy}
        onClick={onClick}
        title={eligibility.reason}
      >
        {busy ? '...' : LABELS[action] ?? action}
      </button>
      {!eligibility.eligible && eligibility.reason && (
        <div className="action-reason">
          {eligibility.reason}
          {eligibility.etaAt ? ` · ${fmtRelative(eligibility.etaAt)}` : ''}
        </div>
      )}
      {error && <div className="action-reason" style={{ color: 'var(--red)' }}>{error}</div>}
    </div>
  );
}
