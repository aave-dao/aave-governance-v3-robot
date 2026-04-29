'use client';

import { addressExplorerUrl } from '@/lib/explorer-client';

type Props = {
  address: string;
  chainId: number;
  /** When true, render the full address (default: shortened 0x123…abcd). */
  full?: boolean;
};

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function AddressLink({ address, chainId, full }: Props) {
  const url = addressExplorerUrl(chainId, address);
  const text = full ? address : short(address);
  if (!url) return <span className="mono">{text}</span>;
  return (
    <a className="mono" href={url} target="_blank" rel="noreferrer">
      {text}
    </a>
  );
}
