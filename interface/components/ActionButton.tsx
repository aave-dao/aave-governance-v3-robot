'use client';

import { useState } from 'react';
import { Lock, Send, Clock, Zap, Check, Wallet } from 'lucide-react';
import type { Address, Hex } from 'viem';
import { cn } from './ui/cn';
import { fmtRelative } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import { useConfig } from '@/lib/use-config';
import { useWallet } from '@/lib/wallet';
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
  const config = useConfig();
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const now = useNow(eligibility.etaAt ?? null);

  const isClientMode = config?.mode === 'client';
  const friendlyLabelFor = LABELS[action] ?? action;

  // "Stale lock": the cache says the action isn't eligible but the ETA already passed. The
  // cache-refresh cron only runs every minute, so for up to ~60s we can be locked when on-chain
  // is actually ready. Treat this as eligible in the UI and let the server's pre-flight `check()`
  // re-validate when the user clicks. Worst case: server returns `not eligible: <reason>` and
  // the toast surfaces it, which is the same behavior as before.
  const isStaleLock =
    !eligibility.eligible &&
    !eligibility.done &&
    eligibility.etaAt !== undefined &&
    eligibility.etaAt <= now;

  // Server-signer flow: POST /api/execute, server signs and sends.
  const sendViaServer = async () => {
    const res = await fetch('/api/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, id, chainId }),
    });
    const json = (await res.json()) as { executionId?: string; error?: string; txHash?: string };
    if (!res.ok || !json.executionId) {
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
    setExecutionId(json.executionId);
    toast.info(
      `${friendlyLabelFor} submitted`,
      json.txHash ? `tx ${json.txHash.slice(0, 10)}…` : 'awaiting receipt',
    );
  };

  // Client-signer flow: prepare on server → sign+send via browser wallet → record back.
  const sendViaWallet = async () => {
    if (!wallet.available) {
      throw new Error('No browser wallet detected');
    }
    if (!wallet.account) {
      const acct = await wallet.connect();
      if (!acct) throw new Error('Wallet connection rejected');
    }
    const prep = await fetch('/api/execute/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, id, chainId }),
    });
    const prepJson = (await prep.json()) as
      | { tx: { chainId: number; to: Address; data: Hex; value: string } }
      | { error: string };
    if (!prep.ok || !('tx' in prepJson)) {
      throw new Error(('error' in prepJson && prepJson.error) || `HTTP ${prep.status}`);
    }
    const { tx } = prepJson;
    const txHash = await wallet.sendTx({
      to: tx.to,
      data: tx.data,
      value: tx.value === '0' ? 0n : BigInt(tx.value),
      chainId: tx.chainId,
    });
    // Record so the rest of the UI (TxStatus, executions list) treats it like server-signed.
    const rec = await fetch('/api/execute/record', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action,
        id,
        chainId: tx.chainId,
        txHash,
        from: wallet.account,
      }),
    });
    const recJson = (await rec.json()) as { executionId?: string; error?: string };
    if (recJson.executionId) setExecutionId(recJson.executionId);
    toast.info(`${friendlyLabelFor} submitted`, `tx ${txHash.slice(0, 10)}…`);
  };

  const send = async () => {
    setBusy(true);
    try {
      if (isClientMode) await sendViaWallet();
      else await sendViaServer();
      setShowConfirm(false);
    } catch (err) {
      toast.error(
        `${friendlyLabelFor} failed`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  if (executionId) {
    return <TxStatus executionId={executionId} />;
  }

  const friendlyLabel = label ?? LABELS[action] ?? action;
  const buttonVariant = variantToButton(variant);

  if (!eligibility.eligible && !isStaleLock) {
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

  const Icon = isClientMode ? Wallet : Send;
  const description = isClientMode
    ? 'Server will re-check eligibility, prepare the calldata, then your wallet signs and broadcasts the tx.'
    : 'The server will re-run the eligibility check before signing. This will spend gas.';

  return (
    <>
      <div className="inline-flex flex-col items-stretch gap-1 min-w-0">
        <Button
          variant={buttonVariant}
          size="sm"
          leftIcon={<Icon size={12} strokeWidth={2.25} />}
          onClick={() => setShowConfirm(true)}
          className="justify-start"
        >
          {friendlyLabel}
        </Button>
        <ReadyLine
          clientMode={isClientMode}
          walletConnected={!!wallet.account}
          stale={isStaleLock}
        />
      </div>
      <ConfirmModal
        open={showConfirm}
        onClose={() => !busy && setShowConfirm(false)}
        onConfirm={send}
        title={`Confirm: ${friendlyLabel}`}
        description={description}
        details={[
          { label: 'action', value: action },
          { label: 'chainId', value: chainId },
          { label: 'id', value: id },
          ...(isClientMode && wallet.account
            ? [{ label: 'from', value: wallet.account }]
            : []),
        ]}
        confirmLabel={isClientMode ? 'Sign in wallet' : `Send ${friendlyLabel}`}
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

function ReadyLine({
  clientMode,
  walletConnected,
  stale,
}: {
  clientMode: boolean;
  walletConnected: boolean;
  stale?: boolean;
}) {
  if (clientMode && !walletConnected) {
    return (
      <div className="flex items-center gap-1 text-[10.5px] font-mono leading-snug text-warn">
        <Wallet size={9} strokeWidth={2.5} className="shrink-0" />
        <span>connect wallet to sign</span>
      </div>
    );
  }
  if (stale) {
    return (
      <div className="flex items-center gap-1 text-[10.5px] font-mono leading-snug text-success">
        <Zap size={9} strokeWidth={2.5} className="shrink-0" />
        <span>ready · server will re-check</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-[10.5px] font-mono leading-snug text-success">
      <Zap size={9} strokeWidth={2.5} className="shrink-0" />
      <span>ready now</span>
    </div>
  );
}
