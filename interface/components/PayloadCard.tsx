'use client';

import { useState } from 'react';
import { ChevronRight, Copy, ExternalLink, Zap, ShieldAlert, Coins } from 'lucide-react';
import { fmtAbsolute } from '@/lib/format';
import { Card, CardBody, CardHeader, CardTitle } from './ui/Card';
import { Badge, stateBadgeTone } from './ui/Badge';
import { ActionButton } from './ActionButton';
import { AddressLink } from './AddressLink';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';
import { cn } from './ui/cn';

type ExecutionAction = {
  target: string;
  withDelegateCall: boolean;
  accessLevel: number;
  value: string;
  signature: string;
  callData: string;
};

type PayloadRaw = {
  createdAt: number | null;
  queuedAt: number | null;
  executedAt: number | null;
  cancelledAt: number | null;
  expirationTime: number | null;
  delay: number | null;
  gracePeriod: number | null;
  executionActions: ExecutionAction[];
} | null;

type PayloadShape = {
  chainId: number;
  payloadId: number;
  chainName: string;
  payloadsController: string;
  state: number;
  stateName: string;
  actionCount: number;
  executable: { eligible: boolean; reason?: string; etaAt?: number };
  raw: PayloadRaw;
};

const accessLevelLabel = (a: number): string => {
  switch (a) {
    case 1:
      return 'Level 1';
    case 2:
      return 'Level 2';
    default:
      return `Level ${a}`;
  }
};

export function PayloadCard({ payload }: { payload: PayloadShape }) {
  const [expanded, setExpanded] = useState(false);
  const raw = payload.raw;
  const actions = raw?.executionActions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle eyebrow={`${payload.chainName} · chainId ${payload.chainId}`}>
          Payload <span className="font-mono tabular-nums text-fg-muted">#{payload.payloadId}</span>
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge tone={stateBadgeTone(payload.stateName)}>{payload.stateName}</Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-4 px-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
          <span className="text-fg-dim">{payload.actionCount} action{payload.actionCount === 1 ? '' : 's'}</span>
          <span className="text-fg-dim hidden sm:inline">·</span>
          <span className="text-fg-dim">controller</span>
          <AddressLink address={payload.payloadsController} chainId={payload.chainId} showIcon />
        </div>

        {raw && (
          <PayloadTiming raw={raw} />
        )}

        {actions.length > 0 && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-elev px-2.5 text-[12px] font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
            >
              <ChevronRight
                size={12}
                strokeWidth={2.5}
                className={cn('transition-transform duration-150', expanded && 'rotate-90')}
              />
              {actions.length} action{actions.length === 1 ? '' : 's'}
            </button>
            {expanded && (
              <div className="space-y-3">
                {actions.map((a, i) => (
                  <ActionRow key={i} index={i} action={a} chainId={payload.chainId} />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="pt-2">
          <ActionButton
            action="executePayload"
            id={String(payload.payloadId)}
            chainId={payload.chainId}
            eligibility={payload.executable}
            variant="payload"
          />
        </div>
      </CardBody>
    </Card>
  );
}

function PayloadTiming({ raw }: { raw: NonNullable<PayloadRaw> }) {
  const items = [
    { label: 'created', ts: raw.createdAt },
    { label: 'queued', ts: raw.queuedAt },
    { label: 'executed', ts: raw.executedAt },
    { label: 'cancelled', ts: raw.cancelledAt },
  ].filter((i) => i.ts && i.ts > 0) as Array<{ label: string; ts: number }>;
  if (items.length === 0 && !raw.delay) return null;
  return (
    <dl className="grid grid-cols-[80px_1fr] gap-y-1 gap-x-3 text-[12px]">
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="text-fg-dim">{it.label}</dt>
          <dd className="font-mono text-fg" suppressHydrationWarning>
            {fmtAbsolute(it.ts)}
          </dd>
        </div>
      ))}
      {raw.delay && raw.delay > 0 && (
        <div className="contents">
          <dt className="text-fg-dim">delay</dt>
          <dd className="font-mono text-fg">{(raw.delay / 3600).toFixed(0)}h ({raw.delay}s)</dd>
        </div>
      )}
    </dl>
  );
}

function ActionRow({
  index,
  action,
  chainId,
}: {
  index: number;
  action: ExecutionAction;
  chainId: number;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState<'target' | 'data' | null>(null);

  const copy = async (what: 'target' | 'data', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1500);
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <div className="rounded-md border border-border bg-surface-elev/50 p-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border bg-surface font-mono text-[10px] font-medium text-fg-muted">
          {index}
        </span>
        <span className="flex-1 truncate font-mono text-[12px] font-semibold text-fg">
          {action.signature || <span className="italic text-fg-dim">(no signature)</span>}
        </span>
        <div className="flex items-center gap-1">
          {action.withDelegateCall && (
            <Badge tone="warn" size="xs" icon={<ShieldAlert size={10} strokeWidth={2.5} />}>
              delegate
            </Badge>
          )}
          <Badge tone="accent" size="xs" icon={<Zap size={10} strokeWidth={2.5} />}>
            {accessLevelLabel(action.accessLevel)}
          </Badge>
          {action.value !== '0' && (
            <Badge tone="success" size="xs" icon={<Coins size={10} strokeWidth={2.5} />}>
              {action.value}
            </Badge>
          )}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-[80px_1fr] gap-y-2 gap-x-3 text-[12px]">
        <dt className="text-fg-dim">target</dt>
        <dd className="flex items-center gap-2 font-mono break-all">
          <AddressLink address={action.target} chainId={chainId} full showIcon />
          <button
            type="button"
            onClick={() => copy('target', action.target)}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-dim hover:bg-surface hover:text-fg"
            aria-label="Copy target"
          >
            <Copy size={11} strokeWidth={2.25} />
          </button>
          {copied === 'target' && <span className="text-[10px] text-success">copied</span>}
        </dd>
        <dt className="text-fg-dim">callData</dt>
        <dd className="font-mono text-[11px] text-fg break-all rounded bg-surface px-2 py-1.5 max-h-24 overflow-y-auto leading-relaxed">
          <div className="flex items-start justify-between gap-2">
            <span className="flex-1 break-all">{action.callData || '0x'}</span>
            <button
              type="button"
              onClick={() => copy('data', action.callData)}
              className="sticky top-0 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-dim hover:bg-surface-elev hover:text-fg"
              aria-label="Copy callData"
            >
              <Copy size={11} strokeWidth={2.25} />
            </button>
          </div>
          {copied === 'data' && <span className="text-[10px] text-success">copied</span>}
        </dd>
      </dl>
    </div>
  );
}

void ExternalLink; // suppress unused-import lint when chevron-only branches used
