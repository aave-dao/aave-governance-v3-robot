'use client';

import { useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  Check,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import useSWR from 'swr';
import { formatUnits } from 'viem';
import { Modal } from './ui/Modal';
import { AddressLink } from './AddressLink';
import { cn } from './ui/cn';

type Status = 'ok' | 'warn' | 'critical' | 'error';

type ChainRow = {
  chainId: number;
  name: string;
  account: string;
  nativeSymbol: string;
  balanceWei: string;
  gasPriceWei: string;
  status: Status;
  rounds: number | null;
  roundCostWei: string;
  actions: Array<{ name: string; gasUnits: string; costWei: string }>;
  error?: string;
};

type HealthResponse = {
  account: string | null;
  overall: Status;
  minRounds: number;
  chains: ChainRow[];
} & { error?: string };

const fetcher = (url: string): Promise<HealthResponse> => fetch(url).then((r) => r.json());

const STATUS_META: Record<Status, { label: string; bg: string; icon: React.ReactNode }> = {
  ok: {
    label: 'Healthy',
    bg: 'border-success-border bg-success-bg text-success',
    icon: <Check size={12} strokeWidth={2.5} />,
  },
  warn: {
    label: 'Low balance',
    bg: 'border-warn-border bg-warn-bg text-warn',
    icon: <AlertTriangle size={12} strokeWidth={2.5} />,
  },
  critical: {
    label: 'Critical',
    bg: 'border-danger-border bg-danger-bg text-danger',
    icon: <AlertCircle size={12} strokeWidth={2.5} />,
  },
  error: {
    label: 'Error',
    bg: 'border-danger-border bg-danger-bg text-danger',
    icon: <AlertCircle size={12} strokeWidth={2.5} />,
  },
};

const fmtNative = (wei: string, sym: string, dp = 4): string => {
  try {
    const s = formatUnits(BigInt(wei), 18);
    const [whole, dec = ''] = s.split('.');
    const truncated = dec.slice(0, dp).padEnd(dp, '0');
    return `${Number(whole).toLocaleString('en-US')}.${truncated} ${sym}`;
  } catch {
    return `${wei} ${sym}`;
  }
};

const fmtGwei = (wei: string): string => {
  try {
    const s = formatUnits(BigInt(wei), 9);
    return `${Number(s).toLocaleString('en-US', { maximumFractionDigits: 2 })} gwei`;
  } catch {
    return `${wei} wei`;
  }
};

export function ExecutorHealthBar() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isValidating, mutate } = useSWR<HealthResponse>(
    '/api/health',
    fetcher,
    { refreshInterval: 5 * 60_000, revalidateOnFocus: false },
  );

  const chains = data?.chains ?? [];
  const overall: Status = data?.error ? 'error' : data?.overall ?? 'ok';
  const meta = STATUS_META[overall];
  const worstChain =
    chains.find((c) => c.status === 'critical' || c.status === 'error') ??
    chains.find((c) => c.status === 'warn');
  const minRoundsAcrossChains = chains.reduce<number | null>(
    (acc, c) =>
      c.rounds === null ? acc : acc === null || c.rounds < acc ? c.rounds : acc,
    null,
  );

  const summary = data?.error
    ? data.error
    : isLoading
      ? 'Probing signer balances…'
      : worstChain
        ? `${worstChain.name}: ${worstChain.rounds === null ? '—' : `${worstChain.rounds} rounds`}`
        : minRoundsAcrossChains !== null
          ? `worst chain: ${minRoundsAcrossChains.toLocaleString()} rounds`
          : 'all chains healthy';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'group flex w-full items-center gap-3 rounded-lg border bg-surface px-4 py-3 text-left transition-colors',
          'hover:border-border-strong hover:bg-surface-elev',
          data?.error
            ? STATUS_META.error.bg
            : 'border-border',
        )}
        aria-label="Open executor health details"
      >
        <span
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-md border',
            meta.bg,
          )}
        >
          {isLoading || isValidating ? (
            <Loader2 size={14} strokeWidth={2.5} className="animate-spin" />
          ) : (
            <Activity size={14} strokeWidth={2.5} />
          )}
        </span>
        <div className="flex flex-1 flex-col min-w-0">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="font-medium text-fg">Executor</span>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.04em]',
                meta.bg,
              )}
            >
              {meta.icon}
              {meta.label}
            </span>
            {data?.account && (
              <span className="hidden sm:inline font-mono text-[11px] text-fg-dim truncate">
                {short(data.account)}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">
            {summary}
          </div>
        </div>
        <ChevronDown
          size={14}
          strokeWidth={2.25}
          className="shrink-0 text-fg-dim transition-transform group-hover:translate-y-px"
        />
      </button>

      <HealthDetailsModal
        open={open}
        onClose={() => setOpen(false)}
        data={data}
        isValidating={isValidating}
        onRefresh={() => mutate()}
      />
    </>
  );
}

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function HealthDetailsModal({
  open,
  onClose,
  data,
  isValidating,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  data: HealthResponse | undefined;
  isValidating: boolean;
  onRefresh: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <div className="flex items-center gap-2">
          <Activity size={16} strokeWidth={2.5} className="text-accent" />
          Executor health
        </div>
      }
      description={
        data?.account ? (
          <span className="font-mono text-[12px]">
            signer{' '}
            <AddressLink address={data.account} chainId={1} full showIcon />
          </span>
        ) : undefined
      }
    >
      {data?.error ? (
        <div className="rounded-md border border-danger-border bg-danger-bg px-3 py-2.5 text-[12px] font-mono text-danger">
          {data.error}
        </div>
      ) : data ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[12px]">
            <div className="text-fg-muted">
              {data.chains.length} chain{data.chains.length === 1 ? '' : 's'} probed · threshold{' '}
              <span className="font-mono">{data.minRounds}</span> rounds
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isValidating}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-elev px-2.5 text-[11px] text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50"
            >
              <RefreshCw
                size={11}
                strokeWidth={2.5}
                className={isValidating ? 'animate-spin' : ''}
              />
              Refresh
            </button>
          </div>
          <div className="-mx-1 max-h-[60vh] overflow-y-auto rounded-md border border-border">
            {data.chains.map((c) => (
              <ChainRow key={c.chainId} chain={c} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-10 rounded-md" />
          ))}
        </div>
      )}
    </Modal>
  );
}

function ChainRow({ chain }: { chain: ChainRow }) {
  const meta = STATUS_META[chain.status];
  const rounds =
    chain.rounds === null
      ? '∞'
      : chain.rounds.toLocaleString('en-US');

  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn(
            'inline-flex h-5 w-5 shrink-0 place-items-center grid rounded-md border',
            meta.bg,
          )}
        >
          {meta.icon}
        </span>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 text-[12px] font-medium">
            <span className="text-fg truncate">{chain.name}</span>
            <span className="font-mono text-[10px] text-fg-dim tabular-nums">
              {chain.chainId}
            </span>
          </div>
          {chain.error ? (
            <span className="truncate font-mono text-[11px] text-danger">
              {chain.error}
            </span>
          ) : (
            <span className="font-mono text-[11px] text-fg-dim">
              {fmtNative(chain.balanceWei, chain.nativeSymbol)} · {fmtGwei(chain.gasPriceWei)}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end justify-center text-right">
        <span
          className={cn(
            'font-mono text-[12px] font-semibold tabular-nums',
            chain.status === 'ok'
              ? 'text-fg'
              : chain.status === 'warn'
                ? 'text-warn'
                : 'text-danger',
          )}
        >
          {rounds}
          <span className="text-fg-dim font-normal"> rounds</span>
        </span>
      </div>
    </div>
  );
}
