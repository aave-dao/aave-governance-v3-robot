// Records a tx that the client wallet already submitted, so the rest of the UI (TxStatus,
// recent executions, the cron-runs feed) treats it the same as a server-signed tx.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { executions } from '@/db/schema';
import { ulid } from '@/lib/ulid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  action: z.enum([
    'activateVoting',
    'executeProposal',
    'cancelProposal',
    'submitStorageRoots',
    'createVote',
    'closeAndSendVote',
    'executePayload',
  ]),
  id: z.string().regex(/^\d+$/),
  chainId: z.number().int().positive(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  /** Wallet address that signed the tx; stored for diagnostics. */
  from: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let parsed;
  try {
    parsed = Body.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { action, id, chainId, txHash, from } = parsed.data;

  const isPayload = action === 'executePayload';
  const executionId = ulid();
  await db.insert(executions).values({
    id: executionId,
    action,
    proposalId: isPayload ? null : BigInt(id),
    chainId,
    payloadId: isPayload ? Number(id) : null,
    status: 'submitted',
    txHash,
    requestedBy: from ?? req.headers.get('x-forwarded-for') ?? null,
  });
  return NextResponse.json({ executionId, txHash });
}
