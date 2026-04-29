'use client';

import { ExternalLink } from 'lucide-react';
import { addressExplorerUrl } from '@/lib/explorer-client';
import { cn } from './ui/cn';

type Props = {
  address: string;
  chainId: number;
  /** When true, render the full address (default: shortened 0x123…abcd). */
  full?: boolean;
  /** ENS name to display in place of the truncated address. */
  ensName?: string | null;
  className?: string;
  showIcon?: boolean;
};

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function AddressLink({
  address,
  chainId,
  full,
  ensName,
  className,
  showIcon,
}: Props) {
  const url = addressExplorerUrl(chainId, address);
  const label = ensName ?? (full ? address : short(address));
  const cls = cn(
    'inline-flex items-center gap-1.5 transition-colors',
    ensName ? 'font-sans text-fg' : 'font-mono text-fg-muted',
    url && 'hover:text-accent',
    className,
  );
  if (!url) return <span className={cls}>{label}</span>;
  return (
    <a className={cls} href={url} target="_blank" rel="noreferrer">
      <span className={ensName ? 'font-medium' : ''}>{label}</span>
      {showIcon && <ExternalLink size={11} strokeWidth={2.25} className="opacity-60" />}
    </a>
  );
}
