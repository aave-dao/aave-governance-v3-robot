'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

// Busts the feed cache tag(s) via /api/feeds/refresh, then re-runs the server component so
// the next render picks up the freshly-scanned data. Same fetch → router.refresh() pattern
// as the proposal refresh button.
export function RefreshButton({ chainId }: { chainId?: number }) {
  const router = useRouter();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onRefresh = async () => {
    if (submitting || isPending) return;
    setSubmitting(true);
    try {
      const qs = chainId ? `?chain=${chainId}` : '';
      const res = await fetch(`/api/feeds/refresh${qs}`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || body.ok === false) {
        toast.error(`Refresh failed: ${body.error ?? `HTTP ${res.status}`}`);
      } else {
        toast.success(chainId ? 'Re-scanning chain…' : 'Re-scanning all chains…');
      }
    } catch (err) {
      toast.error(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
      startTransition(() => router.refresh());
    }
  };

  const busy = submitting || isPending;
  return (
    <Button
      variant="default"
      size="sm"
      onClick={onRefresh}
      disabled={busy}
      leftIcon={<RefreshCw size={13} className={busy ? 'animate-spin' : ''} />}
    >
      {busy ? 'Refreshing…' : 'Refresh'}
    </Button>
  );
}
