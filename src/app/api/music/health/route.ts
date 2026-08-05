import { NextResponse } from 'next/server';
import { getSourceHealth } from '@/lib/sourceHealth';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { sources: getSourceHealth(), checkedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
