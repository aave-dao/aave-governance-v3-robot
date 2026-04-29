'use client';

import { Wallet, AlertCircle, Plug } from 'lucide-react';
import { useWallet } from '@/lib/wallet';
import { Button } from './ui/Button';
import { AddressLink } from './AddressLink';
import { cn } from './ui/cn';

export function WalletConnectBar() {
  const wallet = useWallet();

  if (!wallet.available) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-warn-border bg-warn-bg px-4 py-3 text-warn">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-warn-border bg-surface">
          <AlertCircle size={14} strokeWidth={2.5} />
        </span>
        <div className="flex flex-1 flex-col text-[12px]">
          <span className="font-medium">No browser wallet detected</span>
          <span className="font-mono text-[11px] opacity-90">
            Install MetaMask (or any EIP-1193 wallet) to execute actions in client-signer mode.
          </span>
        </div>
      </div>
    );
  }

  if (!wallet.account) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-surface-elev text-fg-muted">
          <Plug size={14} strokeWidth={2.5} />
        </span>
        <div className="flex flex-1 flex-col text-[12px]">
          <span className="font-medium text-fg">Connect a wallet to execute actions</span>
          <span className="font-mono text-[11px] text-fg-dim">
            Server has no signer configured. Actions will be prepared on the server and signed
            from your wallet.
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Wallet size={12} strokeWidth={2.5} />}
          onClick={() => wallet.connect().catch(() => {})}
        >
          Connect wallet
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-success-border bg-success-bg px-4 py-3',
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-success-border bg-surface text-success">
        <Wallet size={14} strokeWidth={2.5} />
      </span>
      <div className="flex flex-1 flex-col text-[12px] min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg">Wallet connected</span>
          <span className="font-mono text-[11px] text-fg-dim">
            chain {wallet.chainId ?? '—'}
          </span>
        </div>
        <span className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">
          <AddressLink
            address={wallet.account}
            chainId={wallet.chainId ?? 1}
            full
            showIcon
          />
        </span>
      </div>
    </div>
  );
}
