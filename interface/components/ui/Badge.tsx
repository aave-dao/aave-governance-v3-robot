import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warn'
  | 'danger'
  | 'pending'
  | 'ready'
  | 'final'
  | 'failed';

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  size?: 'xs' | 'sm';
  icon?: ReactNode;
};

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-elev border-border text-fg-muted',
  accent: 'bg-accent-bg border-accent-border text-accent',
  success: 'bg-success-bg border-success-border text-success',
  warn: 'bg-warn-bg border-warn-border text-warn',
  danger: 'bg-danger-bg border-danger-border text-danger',
  pending: 'bg-accent-bg border-accent-border text-accent',
  ready: 'bg-success-bg border-success-border text-success',
  final: 'bg-surface-elev border-border text-fg-muted',
  failed: 'bg-danger-bg border-danger-border text-danger',
};

const SIZE = {
  xs: 'h-5 px-1.5 text-[10px] gap-1',
  sm: 'h-6 px-2 text-[11px] gap-1.5',
};

export function Badge({
  tone = 'neutral',
  size = 'sm',
  icon,
  className,
  children,
  ...rest
}: Props) {
  return (
    <span
      className={cn(
        'inline-flex select-none items-center rounded-md border font-medium uppercase tracking-[0.04em] leading-none whitespace-nowrap',
        'font-mono',
        TONE[tone],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {icon && <span className="grid place-items-center">{icon}</span>}
      {children}
    </span>
  );
}

// Map proposal/payload state names to a tone.
export const stateBadgeTone = (stateName: string): BadgeTone => {
  const s = stateName.toLowerCase();
  if (s === 'executed' || s === 'completed') return 'success';
  if (s === 'executing' || s === 'active' || s === 'queued') return 'accent';
  if (s === 'cancelled' || s === 'failed' || s === 'expired') return 'danger';
  return 'neutral';
};
