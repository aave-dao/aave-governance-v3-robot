import Link from 'next/link';
import { Activity } from 'lucide-react';

export function AppBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold tracking-tight min-w-0"
          aria-label="Aave Governance V3 Robot home"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent-bg text-accent">
            <Activity size={15} strokeWidth={2.5} />
          </span>
          <span className="text-[15px] truncate">
            <span className="hidden sm:inline">Aave Governance V3</span>
            <span className="sm:hidden">Aave Gov V3</span>
          </span>
          <span className="rounded-md border border-border-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Robot
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 text-xs text-fg-dim">
          <span className="font-mono hidden sm:inline">cached every minute</span>
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
        </div>
      </div>
    </header>
  );
}
