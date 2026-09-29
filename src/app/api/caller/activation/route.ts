import { getCloudflareBindings } from '@/lib/cloudflare';
import { callerEnabled } from '@/lib/caller-v2/activation';
import { requireApiSession } from '@/lib/session';
import { getM2OwnerIdentityActor } from '@/lib/revenue-engine/m2-owner-identity-actor';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  const auth=await requireApiSession(request);
  if('response' in auth)return auth.response;
  const owner=getM2OwnerIdentityActor(auth.session.user.email);
  return Response.json({enabled:Boolean(owner)&&callerEnabled(getCloudflareBindings()??process.env,'axiom')},
    {headers:{'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie'}});
}
