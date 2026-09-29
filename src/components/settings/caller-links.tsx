"use client";
import { useEffect,useState } from 'react';
import type { LinkCandidate } from '@/lib/caller-v2/link-preview';
import type { LinkIdentity } from '@/lib/caller-v2/peer-contract';

type State={configured:boolean;links:{linkId:string;name:string|null;state:string;orbitRef:{entityId:string}}[];deliveries:{deliveryKey:string;status:string;lastError:string|null}[]};
type Preview={link:LinkIdentity;engine:LinkCandidate;orbit:LinkCandidate;previewRevision:string};
export function CallerLinks(){
  const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [engineQuery,setEngineQuery]=useState(''),[orbitQuery,setOrbitQuery]=useState('');
  const [choices,setChoices]=useState<{engine:LinkCandidate[];orbit:LinkCandidate[]}|null>(null),[ei,setEi]=useState(''),[oi,setOi]=useState(''),[preview,setPreview]=useState<Preview|null>(null);
  async function load(){try{const r=await fetch('/api/caller/links');if(!r.ok)throw new Error();setState(await r.json());}catch{setError('Linked calling settings could not be loaded.');}}
  useEffect(()=>{void load();},[]);
  async function send<T=unknown>(command:unknown):Promise<T|null>{setBusy(true);setError('');try{const r=await fetch('/api/caller/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});const data=await r.json() as T & {error?:string};if(!r.ok){setError(data.error==='REVISION_CONFLICT'?'The selected records changed. Search and review them again.':`Could not complete the request (${data.error??'unavailable'}). Saved links and deliveries remain available below.`);return null;}return data;}catch{setError('Connection interrupted. Use Resume for a pending link.');return null;}finally{setBusy(false);await load();}}
  return <section className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Linked calling with Orbit</h2>
    <p className="text-sm text-slate-600">Choose the same business and contact in both apps. A link shares calling ownership, contact stops and call history. Orbit&apos;s private notes and commercial decisions stay in Orbit.</p>
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    {state&&!state.configured?<p className="text-sm">The server connection to the selected Orbit workspace has not been configured. Complete the peer-secret setup in the connected-calling release guide before linking records.</p>:state&&<>
      <form className="flex flex-wrap gap-3" onSubmit={async e=>{e.preventDefault();setPreview(null);setEi('');setOi('');setChoices(await send<{engine:LinkCandidate[];orbit:LinkCandidate[]}>({action:'search',engineQuery,orbitQuery}));}}>
        <label className="text-sm">Engine business<input className="block rounded border p-2" value={engineQuery} onChange={e=>setEngineQuery(e.target.value)} required maxLength={160}/></label>
        <label className="text-sm">Orbit business<input className="block rounded border p-2" value={orbitQuery} onChange={e=>setOrbitQuery(e.target.value)} required maxLength={160}/></label><button disabled={busy} className="self-end rounded border px-3 py-2">Find records</button>
      </form>
      {choices&&<div className="space-y-3"><label className="block text-sm">Engine record<select className="ml-2 max-w-full rounded border p-2" value={ei} onChange={e=>{setEi(e.target.value);setPreview(null);}}><option value="">Select a business</option>{choices.engine.map((c,i)=><option key={i} value={i}>{c.businessName} · {c.phone??'No phone'} · {c.source.entityId}</option>)}</select></label>
        <label className="block text-sm">Orbit contact<select className="ml-2 max-w-full rounded border p-2" value={oi} onChange={e=>{setOi(e.target.value);setPreview(null);}}><option value="">Select a contact</option>{choices.orbit.map((c,i)=><option key={i} value={i}>{c.businessName} · {c.contactName} · {c.phone} · {c.source.entityType}</option>)}</select></label>
        {(!choices.engine.length||!choices.orbit.length)&&<p>No matching confirmed contacts. Add or confirm the contact in Orbit first.</p>}
        <button className="rounded border px-3 py-2" disabled={busy||ei===''||oi===''} onClick={async()=>{const c=choices.orbit[Number(oi)]!;setPreview(await send<Preview>({action:'preview',engineEntityId:choices.engine[Number(ei)]!.source.entityId,orbitRef:c.source,orbitContactId:c.contactId}));}}>Review link</button>
      </div>}
      {preview&&<div className="rounded border border-amber-300 bg-amber-50 p-3"><p>Engine: <b>{preview.engine.businessName}</b> · {preview.engine.phone}</p><p>Orbit: <b>{preview.orbit.businessName}</b> · {preview.orbit.contactName} · {preview.orbit.phone}</p>
        {(preview.engine.stopped||preview.orbit.stopped)&&<p>This contact is stopped. Linking preserves that stop.</p>}
        <button className="owner-cta mt-3 rounded px-3 py-2" disabled={busy} onClick={async()=>{if(await send({action:'confirm',link:preview.link,previewRevision:preview.previewRevision}))setPreview(null);}}>Confirm this is the same contact</button></div>}
    </>}
    {!!state?.links.length&&<ul className="space-y-2 text-sm">{state.links.map(l=><li key={l.linkId}>{l.name??'Removed Engine record'} ↔ {l.orbitRef.entityId} · {l.state==='active'?'Linked':'Setup pending'} {l.state!=='active'&&<button className="ml-2 underline" disabled={busy} onClick={()=>void send({action:'resume',linkId:l.linkId})}>Resume setup</button>}</li>)}</ul>}
    {!!state?.deliveries.length&&<div><h3 className="font-medium">Linked updates awaiting delivery</h3><ul className="space-y-2 text-sm">{state.deliveries.map(d=><li key={d.deliveryKey}>{d.deliveryKey.startsWith('stop:')?'Contact stop':'Call update'} · {d.status} {d.lastError&&`· ${d.lastError}`} <button className="ml-2 underline" disabled={busy||!state.configured} onClick={()=>void send({action:'retry',deliveryKey:d.deliveryKey})}>Retry</button></li>)}</ul></div>}
  </section>;
}
