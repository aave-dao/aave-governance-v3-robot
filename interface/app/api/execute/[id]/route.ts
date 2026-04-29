import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import type { Hex } from 'viem';
import { getPublicClient } from '@robot/core/clients';
import { db } from '@/db/client';
import { executions } from '@/db/schema';
import { jsonSafe } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [row] = await db.select().from(executions).where(eq(executions.id, id));
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Lazy upgrade: if this row is 'submitted' and tx hash is set, try to fetch the receipt
  // and promote to 'confirmed' or 'failed'. Cheap because viem caches receipts.
  if (row.status === 'submitted' && row.txHash) {
    try {
      const client = getPublicClient(row.chainId);
      const receipt = await client.getTransactionReceipt({ hash: row.txHash as Hex });
      const finalStatus: 'confirmed' | 'failed' =
        receipt.status === 'success' ? 'confirmed' : 'failed';
      await db
        .update(executions)
        .set({ status: finalStatus, updatedAt: new Date() })
        .where(eq(executions.id, row.id));
      row.status = finalStatus;
      row.updatedAt = new Date();
    } catch {
      /* receipt not yet available; keep status as 'submitted' */
    }
  }

  return NextResponse.json(
    { execution: jsonSafe(row) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
