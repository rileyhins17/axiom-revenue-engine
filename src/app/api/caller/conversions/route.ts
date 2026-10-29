import {getCloudflareBindings,getDatabase} from '@/lib/cloudflare';
import type {CallerDb} from '@/lib/caller-v2/database';
import {handleConversionManagement} from '@/lib/caller-v2/conversion-management';
import {getM2OwnerIdentityActor} from '@/lib/revenue-engine/m2-owner-identity-actor';
import {requireApiSession} from '@/lib/session';

export const dynamic='force-dynamic';
export async function GET(request:Request){
  const auth=await requireApiSession(request);if('response' in auth)return auth.response;
  const actor=getM2OwnerIdentityActor(auth.session.user.email);
  if(!actor)return Response.json({error:'Owner access required.'},{status:403,headers:{'Cache-Control':'no-store'}});
  return handleConversionManagement(getDatabase() as unknown as CallerDb,request,{actor,actorUserId:String(auth.session.user.id)},getCloudflareBindings());
}
export const POST=GET;
