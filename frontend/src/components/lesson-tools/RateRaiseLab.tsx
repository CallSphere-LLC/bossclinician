import runtimeUrl from "./rate-raise-runtime.js?url";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMember } from "@/hooks/useMember";
import { usePlayerSource } from "@/components/player/playerSource";
import { memberRequest } from "@/lib/memberApi";
import { useVersionedToolState } from "./useVersionedToolState";
import { emptyRateState, normaliseRateState, validRateState } from "./rateRaiseState";

const CHANNEL = "boss-rate-lab-v1";
export function RateRaiseLab() {
 const {member} = useMember();
 if (!member) return <p>Please sign in to use your private Rate Raise Lab.</p>;
 return <RateRaiseSession key={member?.id ?? "signed-out"} />;
}
function RateRaiseSession() {
 const {member}=useMember();
 const {preview}=usePlayerSource();
 const tool=useVersionedToolState("rate-raise-lab",emptyRateState,normaliseRateState);
 const frame=useRef<HTMLIFrameElement>(null);
 const [html,setHtml]=useState("");
 const [failed,setFailed]=useState(false);
 const [invalid,setInvalid]=useState(false);
 const current=useRef(tool);current.current=tool;
 const editable=!!member && !member.impersonatedBy && !["readonly","conflict","offline","loading"].includes(tool.status);
 const mayEdit=useRef(editable);mayEdit.current=editable;
 const restore=useCallback(()=>{
  if(!current.current.ready)return;
  frame.current?.contentWindow?.postMessage({channel:CHANNEL,type:"restore",state:current.current.state,editable:mayEdit.current},"*");
 },[]);
 useEffect(()=>{
  let active=true;
  if(!member||preview)return;
  void memberRequest<{html:string}>(`/member/tool-document/rate-raise-lab?expectedMemberId=${member.id}`)
   .then(result=>{if(active) {
     const origin=window.location.origin;
     const runtime=new URL(runtimeUrl,origin).href;
     setHtml(result.html.replaceAll("__RATE_LAB_ORIGIN__",origin).replaceAll("__RATE_LAB_RUNTIME_URL__",runtime));
    }})
   .catch(()=>{if(active)setFailed(true);});
  return()=>{active=false;};
 },[member?.id,preview]);
 useEffect(()=>{
  const listener=(event:MessageEvent)=>{
   // Opaque sandbox origin is expected. Exact source window is mandatory.
   if(event.source!==frame.current?.contentWindow||event.origin!=="null"||event.data?.channel!==CHANNEL)return;
   if(event.data.type==="ready")restore();
   if(event.data.type==="change"&&current.current.ready&&mayEdit.current) {
    const valid=validRateState(event.data.state);setInvalid(!valid);
    if(valid)current.current.setState(event.data.state);
   }
  };
  window.addEventListener("message",listener);
  return()=>window.removeEventListener("message",listener);
 },[restore]);
 useEffect(()=>{restore();},[tool.ready,tool.state,editable,restore]);
 if(preview)return <p>The Rate Raise Lab is available inside the authorized member lesson. Preview does not fetch member data.</p>;
 if(!member)return <p>Please sign in to use your private Rate Raise Lab.</p>;
 if(failed)return <p role="alert">The private lab could not be opened. Reload this lesson or check your membership access.</p>;
 const status=tool.status==="saved"?"Your numbers, dates and checklists are saved privately."
  :tool.status==="saving"?"Saving your numbers, dates and checklists…"
  :tool.status==="error"?"Your latest changes are not saved. Keep this page open and check your connection."
  :tool.status==="conflict"?"This lab changed on another device. Reload saved progress before continuing."
  :tool.status==="readonly"?"Read-only. Your membership or session does not permit saving."
  :tool.ready?"Numbers, dates and fixed choices save automatically. Free text and letters do not save."
  :"Loading your private progress…";
 return <section aria-label="Rate Raise Lab" className="my-6 space-y-3">
  <p role="status" aria-live="polite" className="text-sm">{invalid ? "An entry is outside the supported range. Correct it before changes can be saved. Rates: $0–$10,000; sessions: 0–100; weeks: 1–52; clinicians: whole numbers up to 1,000." : status}</p>
  <p className="text-sm">Do not enter patient information. Names, contact details, notes and generated letters stay only in this open page. Copy or download your draft before leaving. Nothing is sent automatically.</p>
  <button type="button" className="rounded-lg border px-4 py-2 text-sm" onClick={()=>void tool.reload()}>Reload saved numbers and checklists</button>
  {html && tool.ready && !["readonly","offline"].includes(tool.status) && <iframe ref={frame} title="Private Rate Raise Lab" srcDoc={html}
    sandbox="allow-scripts allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox"
    referrerPolicy="no-referrer" onLoad={restore}
    className="w-full rounded-xl border bg-white" style={{height:"min(950px, 85vh)",minHeight:500}} />}
 </section>;
}
