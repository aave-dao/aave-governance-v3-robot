import { NextResponse } from 'next/server';
import { privateKeyToAccount } from 'viem/accounts';
import { hasServerSigner, loadServerEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const env = loadServerEnv();
  const mode = hasServerSigner() ? 'server' : 'client';
  const signerAddress = env.PRIVATE_KEY
    ? privateKeyToAccount(env.PRIVATE_KEY).address
    : null;
  return NextResponse.json(
    { mode, signerAddress },
    { headers: { 'cache-control': 'no-store' } },
  );
}
