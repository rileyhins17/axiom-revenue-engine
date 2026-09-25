'use client';
import { Phone } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { sourceRefSchema } from '@/lib/caller-v2/protocol';


const CallerActivation=createContext(false);
export function CallerActivationProvider({identity,children}:{identity:string|null;children:ReactNode}){
  const [result,setResult]=useState<{identity:string;enabled:boolean}|null>(null);
  useEffect(()=>{
    if(!identity)return;
    const controller=new AbortController();
    void fetch('/api/caller/activation',{cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const value=response.ok?await response.json():null;
        if(!controller.signal.aborted)setResult({identity,enabled:Boolean(value&&typeof value==='object'&&'enabled' in value&&value.enabled===true)});
      }).catch(()=>{if(!controller.signal.aborted)setResult({identity,enabled:false});});
    return()=>controller.abort();
  },[identity]);
  return <CallerActivation.Provider value={Boolean(identity&&result?.identity===identity&&result.enabled)}>{children}</CallerActivation.Provider>;
}

export function useCallerHandoff(prospectId:string):boolean {
  const [selectedId,setSelectedId]=useState<string|null>(null);
  useEffect(()=>{
    const handler=(event:Event)=>{
      const detail=(event as CustomEvent).detail as {source?:unknown;selected?:boolean}|undefined;
      try{const source=sourceRefSchema.parse(detail?.source);
        if(detail?.selected===true&&source.system==='revenue-engine'&&source.connectionId==='axiom-engine'&&source.workspaceId==='axiom'&&source.entityType==='prospect')setSelectedId(source.entityId);
      }catch{/* A page display event never authorizes a source write. */}
    };
    document.addEventListener('axiom-caller:launch-ack',handler);
    return()=>document.removeEventListener('axiom-caller:launch-ack',handler);
  },[]);
  return selectedId===prospectId;
}

/** Only a source reference crosses into the extension; Caller fetches the number. */
export function CallerLaunch({ prospectId, label = 'Open Caller', className = '' }: { prospectId: string; label?: string; className?: string }) {
  const enabled=useContext(CallerActivation);
  if(!enabled)return <span className={className} title="New calls are paused for this workspace. Saved results can still sync.">Calling paused</span>;
  const source = { system: 'revenue-engine', connectionId: 'axiom-engine', workspaceId: 'axiom', entityType: 'prospect', entityId: prospectId };
  return <a href="/settings#caller" data-axiom-caller-source={JSON.stringify(source)}
    className={`inline-flex items-center gap-2 rounded-lg font-medium ${className}`} title="Open Axiom Caller. Connect the extension in Settings if it is unavailable.">
    <Phone className="size-4" aria-hidden="true" />{label}
  </a>;
}
