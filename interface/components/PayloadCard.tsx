'use client';

import { useState } from 'react';
import { StateBadge } from './StateBadge';
import { ActionButton } from './ActionButton';
import { AddressLink } from './AddressLink';
import { fmtAbsolute } from '@/lib/format';

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

const Timestamp = ({ label, ts }: { label: string; ts: number | null | undefined }) => {
  if (!ts || ts === 0) return null;
  return (
    <div className="kv-grid" style={{ gridTemplateColumns: '90px 1fr' }}>
      <div className="k">{label}</div>
      <div className="v" suppressHydrationWarning>
        {fmtAbsolute(ts)}
      </div>
    </div>
  );
};

export function PayloadCard({ payload }: { payload: PayloadShape }) {
  const [expanded, setExpanded] = useState(false);
  const raw = payload.raw;
  const actions = raw?.executionActions ?? [];

  return (
    <div className="card">
      <div className="payload-card-header">
        <div className="mono dim">
          {payload.chainName} · chainId {payload.chainId}
        </div>
        <StateBadge state={payload.stateName} />
      </div>
      <div className="bigid" style={{ fontSize: 18, marginTop: 4 }}>
        payload #{payload.payloadId}
      </div>
      <div className="mono dim" style={{ marginTop: 4 }}>
        {payload.actionCount} action{payload.actionCount === 1 ? '' : 's'} · controller{' '}
        <AddressLink address={payload.payloadsController} chainId={payload.chainId} />
      </div>

      {raw && (
        <div className="payload-timing" style={{ marginTop: 10 }}>
          <Timestamp label="created" ts={raw.createdAt} />
          <Timestamp label="queued" ts={raw.queuedAt} />
          <Timestamp label="executed" ts={raw.executedAt} />
          <Timestamp label="cancelled" ts={raw.cancelledAt} />
          {raw.delay && raw.delay > 0 && (
            <div className="kv-grid" style={{ gridTemplateColumns: '90px 1fr' }}>
              <div className="k">delay</div>
              <div className="v">{raw.delay}s</div>
            </div>
          )}
        </div>
      )}

      {actions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            className="payload-toggle"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '▼' : '▶'} {actions.length} action{actions.length === 1 ? '' : 's'}
          </button>
          {expanded && (
            <div className="payload-actions-list">
              {actions.map((a, i) => (
                <div key={i} className="payload-action">
                  <div className="payload-action-header">
                    <span className="action-index dim">#{i}</span>
                    <span className="payload-action-sig">
                      {a.signature || <span className="dim">(no signature)</span>}
                    </span>
                    <span className="action-tags">
                      {a.withDelegateCall && (
                        <span className="action-tag tag-delegate">DELEGATECALL</span>
                      )}
                      <span className="action-tag tag-access">{accessLevelLabel(a.accessLevel)}</span>
                      {a.value !== '0' && (
                        <span className="action-tag tag-value">value {a.value}</span>
                      )}
                    </span>
                  </div>
                  <div className="kv-grid" style={{ gridTemplateColumns: '90px 1fr', marginTop: 6 }}>
                    <div className="k">target</div>
                    <div className="v">
                      <AddressLink address={a.target} chainId={payload.chainId} full />
                    </div>
                    <div className="k">callData</div>
                    <div className="v calldata">{a.callData || '0x'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="action-row" style={{ marginTop: 12 }}>
        <ActionButton
          action="executePayload"
          id={String(payload.payloadId)}
          chainId={payload.chainId}
          eligibility={payload.executable}
        />
      </div>
    </div>
  );
}
