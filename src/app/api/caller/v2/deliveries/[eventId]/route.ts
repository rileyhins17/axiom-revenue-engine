import { getDatabase } from '@/lib/cloudflare';
import type { CallerDb } from '@/lib/caller-v2/database';
import { handleEngineCallerRequest } from '@/lib/caller-v2/http';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{eventId:string}>}){return handleEngineCallerRequest(getDatabase() as unknown as CallerDb,request,'deliveries/'+(await params).eventId);}
