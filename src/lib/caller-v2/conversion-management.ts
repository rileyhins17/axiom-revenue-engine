import type {CallerDb} from './database';
import type {CallerActor} from '../revenue-engine/caller-integration';
import {z} from 'zod';
import {conversionRequestSchema,previewEngineConversion,requestOrbitConversion,resumeOrbitConversion,requireConversionActor,type ConversionJob} from './conversions';
import {peerGrant,requestPeer,PeerError} from './peer-contract';
import {CallerError,ENGINE_WORKSPACE} from './identity';
import {readCallerJson} from './http';
import {conversionHandoffSchema} from './conversion-contract';

const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
const commandSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('search'),query:z.string().trim().min(1).max(160)}).strict(),
  z.object({action:z.literal('preview'),entityId:z.string().min(1).max(300)}).strict(),
  z.object({action:z.literal('request'),command:conversionRequestSchema}).strict(),
  z.object({action:z.literal('retry'),conversionId:z.string().uuid()}).strict(),
]);
function view(job:ConversionJob,actor:CallerActor){
  const packet=conversionHandoffSchema.parse(JSON.parse(job.payloadJson));
  return {conversionId:job.conversionId,sourceEntityId:job.sourceEntityId,name:packet.reviewedFields.name,status:job.status,error:job.lastError,owned:job.actorId===actor.actorUserId,
    reviewUrl:'https://orbit.getaxiom.ca/calling/conversions/'+job.conversionId};
}
export async function handleConversionManagement(db:CallerDb,request:Request,actor:CallerActor,env:unknown,fetcher=fetch):Promise<Response>{
  try{
    await requireConversionActor(db,actor);
    if(request.method==='GET'){
      let configured=false;try{peerGrant(env);configured=true;}catch{/* Read-only status remains available. */}
      const rows=await db.prepare('SELECT * FROM CallerConversionJob WHERE workspaceId=? ORDER BY createdAt DESC LIMIT 100').bind(ENGINE_WORKSPACE).all<ConversionJob>();
      return json({configured,jobs:rows.results.map(row=>view(row,actor))});
    }
    if(request.method!=='POST')throw new PeerError('METHOD_NOT_ALLOWED',405);
    if(request.headers.get('Origin')!==new URL(request.url).origin)throw new PeerError('PEER_SCOPE',403);
    const command=commandSchema.parse(await readCallerJson(request));
    if(command.action==='search'){
      const rows=await db.prepare('SELECT prospectId AS id,name,phone FROM EngineProspect WHERE name LIKE ? OR prospectId LIKE ? ORDER BY name,prospectId LIMIT 20').bind('%'+command.query+'%','%'+command.query+'%').all();
      return json({candidates:rows.results});
    }
    if(command.action==='preview')return json(await previewEngineConversion(db,command.entityId));
    const grant=peerGrant(env),scope={db,actor,bridge:{grant,send:(op:Parameters<typeof requestPeer>[2],payload:unknown)=>requestPeer(grant,'orbit',op,payload,fetcher)}};
    const job=command.action==='request'?await requestOrbitConversion(scope,command.command):await resumeOrbitConversion(scope,command.conversionId);
    return json({job:view(job,actor)});
  }catch(error){const known=error instanceof PeerError||error instanceof CallerError;return json({error:known?error.code:error instanceof z.ZodError?'INVALID_REQUEST':'PEER_UNAVAILABLE'},known?error.status:error instanceof z.ZodError?400:503);}
}
