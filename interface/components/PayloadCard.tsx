'use client';

import { StateBadge } from './StateBadge';
import { ActionButton } from './ActionButton';

type PayloadShape = {
  chainId: number;
  payloadId: number;
  chainName: string;
  payloadsController: string;
  state: number;
  stateName: string;
  actionCount: number;
  executable: { eligible: boolean; reason?: string; etaAt?: number };
};

export function PayloadCard({ payload }: { payload: PayloadShape }) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
        {payload.payloadsController.slice(0, 10)}…
      </div>
      <div className="action-row">
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
