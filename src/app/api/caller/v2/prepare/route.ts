import { getDatabase, getCloudflareBindings } from '@/lib/cloudflare';
import type { CallerDb } from '@/lib/caller-v2/database';
import { handleEngineCallerRequest } from '@/lib/caller-v2/http';

export const dynamic = 'force-dynamic';
export function POST(request: Request) { return handleEngineCallerRequest(getDatabase() as unknown as CallerDb, request, 'prepare',getCloudflareBindings()??process.env); }
