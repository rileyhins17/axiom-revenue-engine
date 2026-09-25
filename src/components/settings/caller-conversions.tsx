"use client";
import {useCallback,useEffect,useState} from 'react';
import type {previewEngineConversion} from '@/lib/caller-v2/conversions';

type Preview=Awaited<ReturnType<typeof previewEngineConversion>>;
type Job={conversionId:string;name:string;status:string;error:string|null;owned:boolean;reviewUrl:string};
type State={configured:boolean;jobs:Job[]};
const labels:Record<string,string>={pending:'Saved · delivery pending',retry:'Saved · delivery interrupted',pending_review:'Received by Orbit · owner review needed',link_pending:'Client saved in Orbit · link setup pending',completed:'Client linked',review:'Saved · review needed'};
export function CallerConversions(){
  const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
  const [candidates,setCandidates]=useState<{id:string;name:string;phone:string|null}[]>([]),[preview,setPreview]=useState<Preview|null>(null);
  const [commandId,setCommandId]=useState(''),[domain,setDomain]=useState(''),[contactName,setContactName]=useState(''),[work,setWork]=useState(''),[history,setHistory]=useState<string[]>([]);
  const load=useCallback(async()=>{try{const response=await fetch('/api/caller/conversions');if(!response.ok)throw new Error();setState(await response.json());}catch{setError('Client handoffs could not be loaded.');}},[]);
  const choose=useCallback((p:Preview)=>{setPreview(p);setCommandId(crypto.randomUUID());setDomain(p.domain??'');setContactName('');setWork('');setHistory([]);},[]);
  useEffect(()=>{
    void load();const entityId=new URL(window.location.href).searchParams.get('conversionSource');
    if(entityId)void fetch('/api/caller/conversions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'preview',entityId})}).then(async response=>{if(!response.ok)throw new Error();choose(await response.json());}).catch(()=>setError('This business cannot be handed off yet. Finish any active call and review its contact status.'));
  },[load,choose]);
  async function send<T>(body:unknown):Promise<T|null>{setBusy(true);setError('');try{
    const response=await fetch('/api/caller/conversions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json() as T&{error?:string};
    if(!response.ok){setError(data.error==='REVISION_CONFLICT'?'The business changed. Review its current details again.':data.error==='STOPPED'?'This contact is stopped.':data.error==='CLAIM_HELD'?'Finish the active call or retry already in progress.':'The handoff needs review. Any saved request remains listed below.');return null;}return data;
  }catch{setError('Connection interrupted. Check the saved handoff below before sending another.');return null;}finally{setBusy(false);await load();}}
  return <section id="orbit-handoff" className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <h2 className="font-semibold">Create or link a client in Orbit</h2>
    <p className="text-sm text-slate-600">After a real client agreement, review the business and selected call history here. Orbit’s workspace owner confirms the client record there.</p>
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    {state&&!state.configured?<p>The server connection to Orbit needs to be configured before sending a handoff.</p>:state&&<>
      <form className="flex flex-wrap items-end gap-3" onSubmit={async e=>{e.preventDefault();setPreview(null);const result=await send<{candidates:typeof candidates}>({action:'search',query});if(result)setCandidates(result.candidates);}}>
        <label className="text-sm">Engine business<input className="block rounded border p-2" value={query} onChange={e=>setQuery(e.target.value)} required maxLength={160}/></label>
        <button className="rounded border px-3 py-2" disabled={busy}>Find business</button>
      </form>
      {candidates.map(c=><button className="block text-left text-sm underline" key={c.id} disabled={busy} onClick={async()=>{const p=await send<Preview>({action:'preview',entityId:c.id});if(p)choose(p);}}>{c.name} · {c.phone??'No phone'}</button>)}
      {preview&&(preview.existingConversionId?<p>This business already has a saved handoff. Continue it in the list below.</p>:<form className="space-y-3 rounded border p-3" onSubmit={async e=>{e.preventDefault();const result=await send({action:'request',command:{conversionId:commandId,engineSource:preview.source,expectedRevision:preview.revision,confirmedRelationship:true,
        reviewedFields:{name:preview.name,domain:domain.trim()||null,contact:{name:contactName,phone:preview.phone},agreedWork:work,historyEventIds:history}}});if(result)setPreview(null);}}>
        <p><b>{preview.name}</b> · {preview.phone}</p>
        <label className="block text-sm">Actual business domain, if known<input className="block w-full rounded border p-2" value={domain} onChange={e=>setDomain(e.target.value)} maxLength={300}/></label>
        <p className="text-xs text-slate-600">A missing domain stays pending until the actual domain is supplied in Orbit.</p>
        <label className="block text-sm">Confirmed contact name<input className="block w-full rounded border p-2" value={contactName} onChange={e=>setContactName(e.target.value)} required maxLength={160}/></label>
        <label className="block text-sm">Agreed work<textarea className="block w-full rounded border p-2" value={work} onChange={e=>setWork(e.target.value)} maxLength={2000}/></label>
        {!!preview.history.length&&<fieldset><legend className="text-sm font-medium">Call summaries to include</legend>{preview.history.map(x=><label key={x.eventId} className="my-2 block text-sm">
          <input type="checkbox" checked={history.includes(x.eventId)} onChange={e=>setHistory(e.target.checked?[...history,x.eventId]:history.filter(id=>id!==x.eventId))}/> {x.occurredAt.slice(0,10)} · {x.summary}</label>)}</fieldset>}
        <label className="block text-sm"><input type="checkbox" required/> I confirm a real client relationship and have reviewed these details.</label>
        <p className="text-xs text-slate-600">Saving holds this business out of the acquisition call queue. It does not start an audit, monitoring, a proposal or a message.</p>
        <button className="owner-cta rounded px-3 py-2" disabled={busy}>Save handoff and send to Orbit</button>
      </form>)}
    </>}
    {!!state?.jobs.length&&<ul className="space-y-3 text-sm">{state.jobs.map(job=><li key={job.conversionId}>
      <b>{job.name}</b> · {labels[job.status]??'Review needed'} {job.error&&<span>· {job.error}</span>}
      <div className="mt-1 flex flex-wrap gap-3">{['pending_review','link_pending','completed'].includes(job.status)&&<a className="underline" href={job.reviewUrl}>Review in Orbit</a>}
        {job.owned&&job.status!=='completed'&&<button className="underline" disabled={busy||!state.configured} onClick={()=>void send({action:'retry',conversionId:job.conversionId})}>Retry or check receipt</button>}</div>
    </li>)}</ul>}
  </section>;
}
