import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

type Variant = 'default' | 'primary' | 'success' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

const VARIANT: Record<Variant, string> = {
  default:
    'bg-surface-elev border border-border text-fg hover:bg-surface-hover hover:border-border-strong',
  primary:
    'bg-accent-bg border border-accent-border text-accent hover:bg-[rgb(122_166_255_/_0.18)] hover:text-accent-strong',
  success:
    'bg-success-bg border border-success-border text-success hover:bg-[rgb(74_222_128_/_0.18)]',
  danger:
    'bg-danger-bg border border-danger-border text-danger hover:bg-[rgb(248_113_113_/_0.18)]',
  ghost: 'bg-transparent border border-transparent text-fg-muted hover:bg-surface hover:text-fg',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5',
  md: 'h-9 px-3.5 text-[13px] gap-2',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'default',
    size = 'md',
    loading = false,
    disabled,
    leftIcon,
    rightIcon,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-md font-medium leading-none',
        'transition-[background,border,transform,opacity] duration-100',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'active:scale-[0.98]',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : leftIcon}
      {children}
      {rightIcon}
    </button>
  );
});
