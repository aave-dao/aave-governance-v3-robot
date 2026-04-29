'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  leftIcon?: ReactNode;
  onClear?: () => void;
};

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { leftIcon, onClear, className, value, ...rest },
  ref,
) {
  return (
    <div className="relative inline-flex w-full items-center">
      {leftIcon && (
        <span className="pointer-events-none absolute left-3 grid place-items-center text-fg-dim">
          {leftIcon}
        </span>
      )}
      <input
        ref={ref}
        value={value}
        className={cn(
          'h-9 w-full rounded-md border border-border bg-surface text-[13px] text-fg',
          'placeholder:text-fg-dim',
          'focus:border-accent-border focus:outline-none focus:ring-2 focus:ring-accent/20',
          'transition-[border,box-shadow] duration-100',
          leftIcon ? 'pl-9' : 'pl-3',
          onClear && value ? 'pr-8' : 'pr-3',
          className,
        )}
        {...rest}
      />
      {onClear && value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear"
          className="absolute right-2 grid h-5 w-5 place-items-center rounded text-fg-dim transition-colors hover:bg-surface-elev hover:text-fg"
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
});
