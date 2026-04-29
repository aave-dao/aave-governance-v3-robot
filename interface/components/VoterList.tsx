'use client';

import { useState } from 'react';
import { fmtCompactAave } from '@/lib/format';
import { AddressLink } from './AddressLink';

export type VoteRow = {
  proposalId: string;
  votingChainId: number;
  voter: string;
  support: boolean;
  votingPower: string;
  txHash: string;
  blockNumber: string;
  logIndex: number;
};

const INITIAL_ROWS = 8;

export function VoterList({ votes }: { votes: VoteRow[] }) {
  const [showAll, setShowAll] = useState(false);
  if (votes.length === 0) {
    return <p className="empty">No votes recorded yet.</p>;
  }

  // Sort descending by voting power for the top-N display.
  const sorted = [...votes].sort((a, b) => {
    const pa = BigInt(a.votingPower);
    const pb = BigInt(b.votingPower);
    if (pa === pb) return 0;
    return pa > pb ? -1 : 1;
  });
  const visible = showAll ? sorted : sorted.slice(0, INITIAL_ROWS);

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="voter-row voter-header">
        <div>Voter</div>
        <div>Voting power</div>
        <div>Support</div>
      </div>
      {visible.map((v) => (
        <div key={`${v.txHash}-${v.logIndex}`} className="voter-row">
          <AddressLink address={v.voter} chainId={v.votingChainId} />
          <div className="mono">{fmtCompactAave(BigInt(v.votingPower))}</div>
          <div className={v.support ? 'vote-for-text' : 'vote-against-text'}>
            {v.support ? 'For' : 'Against'}
          </div>
        </div>
      ))}
      {sorted.length > INITIAL_ROWS && (
        <div style={{ textAlign: 'center', padding: 10 }}>
          <button
            type="button"
            className="load-more"
            style={{ fontSize: 12, padding: '6px 16px' }}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? 'Show fewer' : `Show all ${sorted.length}`}
          </button>
        </div>
      )}
    </div>
  );
}
