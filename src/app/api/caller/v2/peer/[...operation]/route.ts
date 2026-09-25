import { getDatabase, getCloudflareBindings } from '@/lib/cloudflare';
import type { CallerDb } from '@/lib/caller-v2/database';
import { handleEnginePeerRequest } from '@/lib/caller-v2/peer';

export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ operation: string[] }> }) {
  const { operation } = await context.params;
  return handleEnginePeerRequest(getDatabase() as unknown as CallerDb, request, operation.join('/'), getCloudflareBindings());
}
