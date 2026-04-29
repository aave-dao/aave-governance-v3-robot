import { NextResponse } from 'next/server';
import { collectHealth, type ChainHealth } from '@robot/cli/health';
import { requirePrivateKey } from '@/lib/env';
import { getLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MIN_ROUNDS = 50;

type ChainHealthJson = {
  chainId: number;
  name: string;
  account: string;
  nativeSymbol: string;
  balanceWei: string;
  gasPriceWei: string;
  status: ChainHealth['status'];
  rounds: number | null;
  roundCostWei: string;
  actions: Array<{ name: string; gasUnits: string; costWei: string }>;
  error?: string;
};

const serializeChain = (c: ChainHealth): ChainHealthJson => ({
  chainId: c.chainId,
  name: c.name,
  account: c.account,
  nativeSymbol: c.nativeSymbol,
  balanceWei: c.balanceWei.toString(),
  gasPriceWei: c.gasPriceWei.toString(),
  status: c.status,
  rounds: c.rounds === Infinity ? null : c.rounds,
  roundCostWei: c.roundCostWei.toString(),
  actions: c.actions.map((a) => ({
    name: a.name,
    gasUnits: a.gasUnits.toString(),
    costWei: a.costWei.toString(),
  })),
  error: c.error,
});

export async function GET() {
  try {
    const rows = await collectHealth(requirePrivateKey(), getLogger(), {
      minRounds: MIN_ROUNDS,
    });
    const chains = rows.map(serializeChain);
    const account = chains[0]?.account ?? null;
    // Aggregate worst status: critical > error > warn > ok
    const order: Record<ChainHealth['status'], number> = {
      ok: 0,
      warn: 1,
      error: 2,
      critical: 3,
    };
    const overall =
      chains.length === 0
        ? 'ok'
        : chains.reduce<ChainHealth['status']>((acc, c) => (order[c.status] > order[acc] ? c.status : acc), 'ok');
    return NextResponse.json(
      { account, overall, minRounds: MIN_ROUNDS, chains },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
