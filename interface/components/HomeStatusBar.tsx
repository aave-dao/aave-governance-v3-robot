'use client';

import { useConfig } from '@/lib/use-config';
import { ExecutorHealthBar } from './ExecutorHealthBar';
import { WalletConnectBar } from './WalletConnectBar';

export function HomeStatusBar() {
  const config = useConfig();
  // Avoid flashing one bar then the other before the config loads — render nothing for the
  // first ~50ms.
  if (!config) return <div className="h-[58px]" aria-hidden />;
  if (config.mode === 'server') return <ExecutorHealthBar />;
  return <WalletConnectBar />;
}
