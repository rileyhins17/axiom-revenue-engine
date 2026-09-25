import { getDatabase } from '@/lib/cloudflare';
import type { CallerDb } from '@/lib/caller-v2/database';
import { handleEngineCallerRequest } from '@/lib/caller-v2/http';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await context.params;
  return handleEngineCallerRequest(getDatabase() as unknown as CallerDb, request, 'receipts/' + eventId);
}
