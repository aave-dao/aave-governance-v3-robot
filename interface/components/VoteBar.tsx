import { fmtCompactAave } from '@/lib/format';
import type { VoteSnapshot } from '@/lib/eta';

type Thresholds = {
  /** Minimum forVotes required, in wei. Drawn as a vertical line on the For bar. */
  yesThresholdWei?: bigint;
  /** Minimum (forVotes - againstVotes) required, in wei. Shown as a caption. */
  yesNoDifferentialWei?: bigint;
};

type Props = {
  snapshot: VoteSnapshot;
  variant: 'compact' | 'full';
  thresholds?: Thresholds;
};

const PRECISION = 10n ** 18n;

export function VoteBar({ snapshot, variant, thresholds }: Props) {
  const { forVotes, againstVotes } = snapshot;
  // Scale the X-axis so the threshold line is always visible. axisMax = max(for, against,
  // threshold). Bar widths are computed against axisMax.
  const threshold = thresholds?.yesThresholdWei ?? 0n;
  const axisMax = maxBig(forVotes, againstVotes, threshold);
  const forPct = axisMax > 0n ? Number((forVotes * 10000n) / axisMax) / 100 : 0;
  const againstPct = axisMax > 0n ? Number((againstVotes * 10000n) / axisMax) / 100 : 0;
  const thresholdPct =
    threshold > 0n && axisMax > 0n ? Number((threshold * 10000n) / axisMax) / 100 : 0;

  if (snapshot.source === null && forVotes === 0n && againstVotes === 0n) {
    return <span className="vote-empty">{snapshot.caption}</span>;
  }

  if (variant === 'compact') {
    const total = forVotes + againstVotes;
    const compactForPct =
      total > 0n ? Number((forVotes * 10000n) / total) / 100 : 0;
    const compactAgainstPct = total > 0n ? 100 - compactForPct : 0;
    return (
      <div className="vote-bar-compact" title={snapshot.caption}>
        <div className="vote-bar-compact-track">
          <div className="vote-bar-for" style={{ width: `${compactForPct}%` }} />
          <div className="vote-bar-against" style={{ width: `${compactAgainstPct}%` }} />
        </div>
        <div className="vote-bar-compact-text">
          <span className="vote-for-text">{fmtCompactAave(forVotes)}</span>
          <span className="dim"> / </span>
          <span className="vote-against-text">{fmtCompactAave(againstVotes)}</span>
        </div>
      </div>
    );
  }

  const diff = forVotes - againstVotes;
  const diffMet =
    thresholds?.yesNoDifferentialWei !== undefined &&
    diff >= thresholds.yesNoDifferentialWei;
  const thresholdMet = threshold > 0n && forVotes >= threshold;

  return (
    <div className="vote-bar-full">
      <div className="vote-row">
        <div className="vote-row-label">
          <span className="vote-for-text">For</span>{' '}
          <span className="mono">{fmtCompactAave(forVotes)}</span>
          {threshold > 0n && (
            <span className="dim">
              {' '}
              · target {fmtCompactAave(threshold)}
              {' '}
              <span className={thresholdMet ? 'vote-for-text' : 'vote-against-text'}>
                {thresholdMet ? '✓' : '✗'}
              </span>
            </span>
          )}
        </div>
        <div className="vote-bar-track">
          <div className="vote-bar-for" style={{ width: `${forPct}%` }} />
          {thresholdPct > 0 && (
            <div
              className="vote-threshold-line"
              style={{ left: `${thresholdPct}%` }}
              title={`yesThreshold ${fmtCompactAave(threshold)} AAVE`}
            />
          )}
        </div>
      </div>
      <div className="vote-row">
        <div className="vote-row-label">
          <span className="vote-against-text">Against</span>{' '}
          <span className="mono">{fmtCompactAave(againstVotes)}</span>
        </div>
        <div className="vote-bar-track">
          <div className="vote-bar-against" style={{ width: `${againstPct}%` }} />
        </div>
      </div>
      {thresholds?.yesNoDifferentialWei !== undefined &&
        thresholds.yesNoDifferentialWei > 0n && (
          <div className="vote-caption mono dim">
            Differential (For − Against): {fmtCompactAave(diff > 0n ? diff : 0n)} ·
            {' '}
            target {fmtCompactAave(thresholds.yesNoDifferentialWei)}
            {' '}
            <span className={diffMet ? 'vote-for-text' : 'vote-against-text'}>
              {diffMet ? '✓' : '✗'}
            </span>
          </div>
        )}
      <div className="vote-caption mono dim">{snapshot.caption}</div>
    </div>
  );
}

const maxBig = (...xs: bigint[]): bigint => {
  let m = 0n;
  for (const x of xs) if (x > m) m = x;
  return m;
};

/** Convert a uint56 contract threshold value into wei (multiply by 1e18). */
export const thresholdWei = (raw: string | null): bigint | undefined => {
  if (!raw) return undefined;
  try {
    return BigInt(raw) * PRECISION;
  } catch {
    return undefined;
  }
};
