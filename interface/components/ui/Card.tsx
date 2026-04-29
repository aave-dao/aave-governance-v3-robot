import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
};

export function Card({ interactive, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface',
        interactive &&
          'cursor-pointer transition-[background,border,transform] duration-100 hover:bg-surface-elev hover:border-border-strong hover:-translate-y-px',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5',
        className,
      )}
      {...rest}
    />
  );
}

export function CardTitle({
  className,
  children,
  eyebrow,
}: {
  className?: string;
  children: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {eyebrow && (
        <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-dim">
          {eyebrow}
        </div>
      )}
      <h3 className="text-[15px] font-semibold leading-tight tracking-tight">{children}</h3>
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-4 sm:px-5', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('border-t border-border px-5 py-3', className)}
      {...rest}
    />
  );
}
