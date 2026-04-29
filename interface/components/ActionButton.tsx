'use client';

import { useState } from 'react';
import { Lock, Send, Clock, Zap, Check } from 'lucide-react';
import { cn } from './ui/cn';
import { fmtRelative } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';
import { ConfirmModal } from './ConfirmModal';
import { TxStatus } from './TxStatus';

type Eligibility = { eligible: boolean; reason?: string; etaAt?: number; done?: boolean };

type Variant = 'governance' | 'voting' | 'payload' | 'cancel';

type Props = {
  action: string;
  /** proposalId for governance/voting actions, payloadId for executePayload (decimal string). */
  id: string;
  chainId: number;
  eligibility: Eligibility;
  variant?: Variant;
  /** Friendly action label (overrides default LABELS lookup). */
  label?: string;
};

const LABELS: Record<string, string> = {
  activateVoting: 'Activate voting',
  executeProposal: 'Execute proposal',
  cancelProposal: 'Cancel proposal',
  submitStorageRoots: 'Submit storage roots',
  createVote: 'Start vote',
  closeAndSendVote: 'Close & send vote',
  executePayload: 'Execute payload',
};

const variantToButton = (v: Variant): 'primary' | 'danger' | 'success' | 'default' => {
  switch (v) {
    case 'governance':
      return 'primary';
    case 'voting':
      return 'primary';
    case 'payload':
      return 'success';
    case 'cancel':
      return 'danger';
  }
};

export function ActionButton({
  action,
  id,
  chainId,
  eligibility,
  variant = 'governance',
  label,
}: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const now = useNow(eligibility.etaAt ?? null);

  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, id, chainId }),
      });
      const json = (await res.json()) as { executionId?: string; error?: string; txHash?: string };
      setShowConfirm(false);
      if (!res.ok || !json.executionId) {
        toast.error(`${LABELS[action] ?? action} failed`, json.error ?? `HTTP ${res.status}`);
        return;
      }
      setExecutionId(json.executionId);
      toast.info(
        `${LABELS[action] ?? action} submitted`,
        json.txHash ? `tx ${json.txHash.slice(0, 10)}…` : 'awaiting receipt',
      );
    } catch (err) {
      toast.error(`${LABELS[action] ?? action} failed`, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (executionId) {
    return <TxStatus executionId={executionId} />;
  }

  const friendlyLabel = label ?? LABELS[action] ?? action;
  const buttonVariant = variantToButton(variant);

  if (!eligibility.eligible) {
    const isDone = eligibility.done === true;
    return (
      <div className="inline-flex flex-col items-stretch gap-1 min-w-0">
        <Button
          variant="ghost"
          size="sm"
          disabled
          leftIcon={
            isDone ? (
              <Check size={12} strokeWidth={2.5} className="text-success" />
            ) : (
              <Lock size={12} strokeWidth={2.25} />
            )
          }
          className={cn(
            'cursor-not-allowed justify-start',
            isDone && 'text-fg-muted line-through decoration-fg-dim/40 decoration-1',
          )}
        >
          {friendlyLabel}
        </Button>
        <ReasonLine
          reason={eligibility.reason}
          etaAt={eligibility.etaAt}
          now={now}
          done={isDone}
        />
      </div>
    );
  }

  return (
    <>
      <div className="inline-flex flex-col items-stretch gap-1 min-w-0">
        <Button
          variant={buttonVariant}
          size="sm"
          leftIcon={<Send size={12} strokeWidth={2.25} />}
          onClick={() => setShowConfirm(true)}
          className="justify-start"
        >
          {friendlyLabel}
        </Button>
        <ReadyLine />
      </div>
      <ConfirmModal
        open={showConfirm}
        onClose={() => !busy && setShowConfirm(false)}
        onConfirm={send}
        title={`Confirm: ${friendlyLabel}`}
        description="The server will re-run the eligibility check before signing. This will spend gas."
        details={[
          { label: 'action', value: action },
          { label: 'chainId', value: chainId },
          { label: 'id', value: id },
        ]}
        confirmLabel={`Send ${friendlyLabel}`}
        variant={buttonVariant === 'default' ? 'primary' : buttonVariant}
        loading={busy}
      />
    </>
  );
}

function ReasonLine({
  reason,
  etaAt,
  now,
  done,
}: {
  reason?: string;
  etaAt?: number;
  now: number;
  done?: boolean;
}) {
  if (!reason && !etaAt) return null;
  if (done) {
    return (
      <div className="flex items-center gap-1 text-[10.5px] font-mono leading-snug text-success">
        <Check size={9} strokeWidth={2.5} className="shrink-0" />
        {reason && <span className="truncate">{reason}</span>}
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-1 text-[10.5px] font-mono leading-snug text-fg-dim"
      suppressHydrationWarning
    >
      <Clock size={9} strokeWidth={2.25} className="shrink-0 opacity-70" />
      {reason && <span className="truncate">{reason}</span>}
      {etaAt && (
        <>
          {reason && <span className="opacity-60">·</span>}
          <span className="text-accent whitespace-nowrap">
            ready {fmtRelative(etaAt, now)}
          </span>
        </>
      )}
    </div>
  );
}

function ReadyLine() {
  return (
    <div className="flex items-center gap-1 text-[10.5px] font-mono leading-snug text-success">
      <Zap size={9} strokeWidth={2.5} className="shrink-0" />
      <span>ready now</span>
    </div>
  );
}
