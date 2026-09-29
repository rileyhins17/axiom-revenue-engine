'use client';
import { Phone } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { sourceRefSchema } from '@/lib/caller-v2/protocol';
import { displayPhone, telHref } from '@/lib/prospect-format';


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

/**
 * The Call button is a real tap-to-dial link, so it dials from an iPhone (home screen app
 * or Safari) and from any computer. When connected calling is on it also carries the source
 * reference: on a computer with Axiom Caller installed, the extension takes the click over
 * (it cancels the dial and opens Caller). Only that reference crosses into the extension;
 * Caller fetches the number itself.
 */
export function CallerLaunch({ prospectId, phone, label, className = '' }: { prospectId: string; phone: string; label?: string; className?: string }) {
  const enabled=useContext(CallerActivation);
  const source = { system: 'revenue-engine', connectionId: 'axiom-engine', workspaceId: 'axiom', entityType: 'prospect', entityId: prospectId };
  return <a href={telHref(phone)} {...(enabled ? { 'data-axiom-caller-source': JSON.stringify(source) } : {})}
    className={`inline-flex items-center gap-2 rounded-lg font-medium ${className}`}
    title={enabled ? 'Call. With Axiom Caller installed on this computer, this opens Caller instead.' : 'Call this number'}>
    <Phone className="size-4 shrink-0" aria-hidden="true" /><span className="tabular-nums">{label ?? displayPhone(phone)}</span>
    {/* Connected calling paused: a quiet desktop-only note; tapping still dials. */}
    {enabled ? null : <span className="hidden rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 md:inline">Caller paused</span>}
  </a>;
}
