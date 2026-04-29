import { NextResponse, type NextRequest } from 'next/server';
import { loadServerEnv } from './env';

// Vercel cron jobs send `Authorization: Bearer ${CRON_SECRET}` automatically when CRON_SECRET
// is set in the project's environment variables. Returns a 401 NextResponse when the header
// is missing or wrong; returns null on success.
export const requireCronAuth = (req: NextRequest): NextResponse | null => {
  const expected = `Bearer ${loadServerEnv().CRON_SECRET}`;
  if (req.headers.get('authorization') !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
};
