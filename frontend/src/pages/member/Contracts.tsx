import { useCallback, useEffect, useState } from 'react';
import { Download, FileSignature, ShieldCheck } from 'lucide-react';
import { MemberShell } from '@/components/member/MemberShell';
import { memberContractsApi, type MemberContract } from '@/lib/contractsApi';
import { useMember } from '@/hooks/useMember';

export default function Contracts() {
  const { member } = useMember();
  const [contracts,setContracts] = useState<MemberContract[]>([]);
  const [disclosure,setDisclosure] = useState('');
  const [intent,setIntent] = useState('');
  const [selected,setSelected] = useState<number | null>(null);
  const [pdfUrl,setPdfUrl] = useState('');
  const [typedName,setTypedName] = useState('');
  const [consent,setConsent] = useState(false);
  const [intended,setIntended] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const load = useCallback(async()=>{ try { const data=await memberContractsApi.list(); setContracts(data.contracts); setDisclosure(data.disclosure); setIntent(data.intent); setError(''); } catch(e) { setError(e instanceof Error?e.message:'Could not load contracts.'); } },[]);
  useEffect(()=>{ void load(); },[load]);
  useEffect(()=>()=>{ if (pdfUrl) URL.revokeObjectURL(pdfUrl); },[pdfUrl]);
  async function open(id:number) { setBusy(true); setError(''); try { const response=await memberContractsApi.file(id); const url=URL.createObjectURL(await response.blob()); setPdfUrl(url); setSelected(id); setConsent(false); setIntended(false); setTypedName(''); } catch(e) { setError(e instanceof Error?e.message:'Could not open PDF.'); } finally { setBusy(false); } }
  async function sign() { if (selected===null || !consent || !intended || typedName.trim().length<3) return; setBusy(true); try { await memberContractsApi.sign(selected,typedName); await load(); setError(''); } catch(e) { setError(e instanceof Error?e.message:'Could not sign this contract.'); } finally { setBusy(false); } }
  async function downloadEvidence(id:number) { try { const response=await memberContractsApi.evidence(id); const url=URL.createObjectURL(await response.blob()); const link=document.createElement('a'); link.href=url; link.download=`contract-signing-record-${id}.pdf`; link.click(); window.setTimeout(()=>URL.revokeObjectURL(url),60_000); } catch(e) { setError(e instanceof Error?e.message:'Could not download signing record.'); } }
  const current=contracts.find(c=>c.id===selected);
  return <MemberShell title="Your contracts" description="Review and sign contracts assigned to your Boss Clinician account. Download a copy for your records.">
    {error && <p role="alert" className="mb-5 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">{error}</p>}
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="space-y-3">{contracts.length===0?<p className="rounded-2xl border border-white/10 p-5 text-white/70">No contracts have been assigned to you.</p>:contracts.map(c=><button key={c.id} onClick={()=>void open(c.id)} className={`w-full rounded-2xl border p-4 text-left transition-colors ${selected===c.id?'border-gold/70 bg-white/10':'border-white/10 bg-white/5 hover:border-gold/40'}`}><span className="flex items-center gap-2 font-semibold text-white"><FileSignature className="size-4 text-gold"/>{c.title}</span><span className="mt-2 block text-sm text-white/65">{c.status==='signed'?'Signed':'Awaiting your signature'}</span></button>)}</div>
      <div className="min-w-0">{!current?<div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-white/70">Choose a contract to review.</div>:<div className="space-y-5">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5"><h2 className="font-display text-2xl text-white">{current.title}</h2><p className="mt-2 text-sm text-white/65">Review every page before signing. This is the exact PDF attached to your signing record.</p><p className="mt-2 break-all text-xs text-white/45">Document SHA-256: {current.pdf_sha256}</p>{pdfUrl&&<a className="mt-3 inline-flex items-center gap-2 text-sm text-gold underline" href={pdfUrl} download={`${current.title}.pdf`}><Download className="size-4"/>Download PDF</a>}</div>
        {pdfUrl&&<iframe title={`${current.title} PDF`} src={pdfUrl} className="h-[60vh] min-h-[28rem] w-full rounded-xl border border-white/10 bg-white"/>}
        {current.status==='signed'?<div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-5 text-white"><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-emerald-300"/><h3 className="font-semibold">Signed</h3></div><p className="mt-2 text-sm">{current.signed_name} · {current.signed_at&&new Date(current.signed_at).toLocaleString()}</p><button onClick={()=>void downloadEvidence(current.id)} className="mt-4 text-sm text-gold underline">Download signing record</button></div>:<div className="rounded-2xl border border-gold/20 bg-white/5 p-5 text-white"><h3 className="font-display text-xl">Sign this contract</h3><p className="mt-2 text-sm text-white/70">Signed in as {member?.email}. Your name, email, time, IP address, and browser will be retained with this document’s fingerprint.</p><label className="mt-5 flex items-start gap-3 text-sm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} className="mt-1"/><span>{disclosure}</span></label><label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={intended} onChange={e=>setIntended(e.target.checked)} className="mt-1"/><span>{intent}</span></label><label className="mt-5 block text-sm font-medium">Type your full legal name<input className="mt-2 w-full rounded-xl border border-white/20 bg-night-deep px-4 py-3 text-white" value={typedName} onChange={e=>setTypedName(e.target.value)} autoComplete="name" maxLength={200}/></label><button disabled={busy || !consent || !intended || typedName.trim().length<3} onClick={()=>void sign()} className="mt-5 rounded-xl bg-gold px-5 py-3 font-semibold text-night-deep disabled:opacity-40">Sign contract</button></div>}
      </div>}</div>
    </div>
  </MemberShell>;
}
