'use client';
import { Phone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { sourceRefSchema } from '@/lib/caller-v2/protocol';

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
  const source = { system: 'revenue-engine', connectionId: 'axiom-engine', workspaceId: 'axiom', entityType: 'prospect', entityId: prospectId };
  return <a href="/settings#caller" data-axiom-caller-source={JSON.stringify(source)}
    className={`inline-flex items-center gap-2 rounded-lg font-medium ${className}`} title="Open Axiom Caller. Connect the extension in Settings if it is unavailable.">
    <Phone className="size-4" aria-hidden="true" />{label}
  </a>;
}
