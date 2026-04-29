'use client';

import { useState, type ReactNode } from 'react';
import { cn } from './cn';

type Props = {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
};

/**
 * Lightweight, dependency-free tooltip. Shown on hover/focus, dismissed on blur. For richer
 * positioning (popper), swap to a real lib later.
 */
export function Tooltip({ content, children, side = 'top', className }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && content && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-40 whitespace-nowrap rounded-md border border-border-strong bg-surface-elev px-2 py-1 text-[11px] font-medium text-fg shadow-lg',
            side === 'top'
              ? 'bottom-full left-1/2 mb-1.5 -translate-x-1/2'
              : 'top-full left-1/2 mt-1.5 -translate-x-1/2',
            className,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
