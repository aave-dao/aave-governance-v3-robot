import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { executions } from '@/db/schema';
import { dispatchExecute, type ActionName } from '@/lib/execute-action';
import { ulid } from '@/lib/ulid';
import { getLogger } from '@/lib/logger';
import { formatError } from '@/lib/format-error';
import { notifyError } from '@robot/core/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  id: z.string().regex(/^\d+$/, 'id must be a decimal string'),
  chainId: z.number().int().positive().optional(),
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
  const { action, id, chainId } = parsed.data;

  const isPayload = action === 'executePayload';
  const executionId = ulid();
  await db.insert(executions).values({
    id: executionId,
    action,
    proposalId: isPayload ? null : BigInt(id),
    chainId: chainId ?? 1,
    payloadId: isPayload ? Number(id) : null,
    status: 'pending',
    requestedBy: req.headers.get('x-forwarded-for') ?? null,
  });

  try {
    const { txHash, chainId: usedChainId } = await dispatchExecute({
      action: action as ActionName,
      id,
      chainId,
    });
    await db
      .update(executions)
      .set({
        status: 'submitted',
        txHash,
        chainId: usedChainId,
        updatedAt: new Date(),
      })
      .where(eq(executions.id, executionId));
    return NextResponse.json({ executionId, txHash, chainId: usedChainId });
  } catch (err) {
    const message = formatError(err);
    const logger = getLogger();
    logger.warn('execute: dispatch failed', { action, id, error: message });
    await db
      .update(executions)
      .set({ status: 'failed', error: message, updatedAt: new Date() })
      .where(eq(executions.id, executionId));
    // Surface to Slack/Telegram. Operator-triggered exec failures (broadcast errors AND
    // post-broadcast reverts/timeouts that bubble out of notifyTxSuccess) were previously
    // only logged — the operator wouldn't see them unless tailing logs.
    await notifyError({
      source: action,
      error: err,
      chainId: chainId ?? undefined,
      meta: { id, executionId },
      logger,
    });
    return NextResponse.json({ executionId, error: message }, { status: 500 });
  }
}
