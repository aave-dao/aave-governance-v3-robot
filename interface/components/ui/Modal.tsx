'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md';
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc key + lock scroll while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    // Focus the dialog so subsequent Tab is constrained inside it (rough trap).
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
      className="fixed inset-0 z-50 grid place-items-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm anim-fade"
        aria-hidden
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          'relative z-10 flex w-full flex-col rounded-xl border border-border-strong bg-surface shadow-2xl outline-none',
          'anim-pop',
          size === 'sm' ? 'max-w-sm' : 'max-w-md',
        )}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-fg-dim transition-colors hover:bg-surface-elev hover:text-fg"
        >
          <X size={14} />
        </button>
        {(title || description) && (
          <div className="flex flex-col gap-1.5 px-5 pt-5 pr-12">
            {title && (
              <h2 id="modal-title" className="text-[16px] font-semibold tracking-tight">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-[13px] text-fg-muted leading-relaxed">{description}</p>
            )}
          </div>
        )}
        {children && <div className="px-5 py-4">{children}</div>}
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-elev/50 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
