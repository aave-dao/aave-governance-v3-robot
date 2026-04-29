import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('skeleton rounded-md', className)}
      aria-hidden
      {...rest}
    />
  );
}
