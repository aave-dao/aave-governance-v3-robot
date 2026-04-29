import { Check, X } from 'lucide-react';
import { fmtCompactAave } from '@/lib/format';
import type { VoteSnapshot } from '@/lib/eta';
import { cn } from './ui/cn';

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

export function VoteBar({ snapshot, variant, thresholds }: Props) {
  const { forVotes, againstVotes } = snapshot;
  const threshold = thresholds?.yesThresholdWei ?? 0n;
  const total = forVotes + againstVotes;
  const axisMax = maxBig(forVotes, againstVotes, threshold);
  const forPct = axisMax > 0n ? Number((forVotes * 10000n) / axisMax) / 100 : 0;
  const againstPct = axisMax > 0n ? Number((againstVotes * 10000n) / axisMax) / 100 : 0;
  const thresholdPct =
    threshold > 0n && axisMax > 0n
      ? Number((threshold * 10000n) / axisMax) / 100
      : 0;

  if (snapshot.source === null && total === 0n) {
    return (
      <span className="font-mono text-[11px] italic text-fg-dim">
        {snapshot.caption}
      </span>
    );
  }

  if (variant === 'compact') {
    const compactForPct = total > 0n ? Number((forVotes * 10000n) / total) / 100 : 0;
    const compactAgainstPct = total > 0n ? 100 - compactForPct : 0;
    return (
      <div className="flex flex-col gap-1.5 min-w-0" title={snapshot.caption}>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-elev">
          <div className="bg-for h-full" style={{ width: `${compactForPct}%` }} />
          <div className="bg-against h-full" style={{ width: `${compactAgainstPct}%` }} />
        </div>
        <div className="flex items-baseline gap-2 font-mono text-[11px] tabular-nums">
          <span className="text-success font-semibold">{fmtCompactAave(forVotes)}</span>
          <span className="text-fg-dim">·</span>
          <span className="text-danger font-semibold">{fmtCompactAave(againstVotes)}</span>
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
    <div className="flex flex-col gap-4">
      <VoteRow
        label="For"
        labelTone="text-success"
        amount={forVotes}
        widthPct={forPct}
        barClass="bg-for"
        target={threshold > 0n ? { wei: threshold, met: thresholdMet, pct: thresholdPct } : undefined}
      />
      <VoteRow
        label="Against"
        labelTone="text-danger"
        amount={againstVotes}
        widthPct={againstPct}
        barClass="bg-against"
      />
      {thresholds?.yesNoDifferentialWei !== undefined && thresholds.yesNoDifferentialWei > 0n && (
        <div className="flex items-center gap-1.5 text-[11px] text-fg-muted font-mono">
          <span>Net</span>
          <span className="font-semibold text-fg">{fmtCompactAave(diff > 0n ? diff : 0n)}</span>
          <span className="text-fg-dim">/ target</span>
          <span className="font-semibold text-fg">
            {fmtCompactAave(thresholds.yesNoDifferentialWei)}
          </span>
          {diffMet ? (
            <Check size={12} strokeWidth={2.5} className="text-success" />
          ) : (
            <X size={12} strokeWidth={2.5} className="text-danger" />
          )}
        </div>
      )}
      <div className="text-[11px] font-mono text-fg-dim">{snapshot.caption}</div>
    </div>
  );
}

type VoteRowProps = {
  label: string;
  labelTone: string;
  amount: bigint;
  widthPct: number;
  barClass: string;
  target?: { wei: bigint; met: boolean; pct: number };
};

function VoteRow({ label, labelTone, amount, widthPct, barClass, target }: VoteRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-1.5 text-[12px]">
        <span className={cn('font-semibold', labelTone)}>{label}</span>
        <span className="font-mono tabular-nums text-fg">{fmtCompactAave(amount)}</span>
        {target && (
          <>
            <span className="text-fg-dim">· target</span>
            <span className="font-mono tabular-nums text-fg-muted">
              {fmtCompactAave(target.wei)}
            </span>
            {target.met ? (
              <Check size={11} strokeWidth={2.5} className="text-success" />
            ) : (
              <X size={11} strokeWidth={2.5} className="text-danger" />
            )}
          </>
        )}
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-elev">
        <div className={cn('h-full transition-[width] duration-300', barClass)} style={{ width: `${widthPct}%` }} />
        {target && target.pct > 0 && (
          <div
            className="absolute inset-y-[-3px] w-[2px] rounded-full bg-fg/85"
            style={{ left: `${target.pct}%` }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
