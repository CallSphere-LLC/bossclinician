import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { FileSignature, FileUp, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { adminContractsApi, type Contract, type ContractAssignment } from '@/lib/contractsApi';

export default function Contracts() {
  const [contracts,setContracts] = useState<Contract[]>([]);
  const [assignments,setAssignments] = useState<ContractAssignment[]>([]);
  const [title,setTitle] = useState('');
  const [file,setFile] = useState<File | null>(null);
  const [selected,setSelected] = useState('');
  const [email,setEmail] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [activity,setActivity] = useState<Array<Record<string,unknown>> | null>(null);
  const [auditValid,setAuditValid] = useState<boolean | null>(null);
  const load = useCallback(async () => { try { const data=await adminContractsApi.list(); setContracts(data.contracts); setAssignments(data.assignments); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load contracts.'); } },[]);
  useEffect(()=>{ void load(); },[load]);
  async function create(e:FormEvent) { e.preventDefault(); if (!file) return; setBusy(true); try { const created=await adminContractsApi.create(title,file); toast.success('Contract added'); setTitle(''); setFile(null); setSelected(String(created.id)); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add contract.'); } finally { setBusy(false); } }
  async function assign(e:FormEvent) { e.preventDefault(); setBusy(true); try { await adminContractsApi.assign(Number(selected),email); toast.success('Assigned to member'); setEmail(''); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not assign contract.'); } finally { setBusy(false); } }
  return <div className="mx-auto max-w-6xl space-y-7 px-4 py-8 sm:px-8">
    <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-soft">Coaching</p><h1 className="mt-2 font-display text-3xl text-ink">Participant contracts</h1><p className="mt-2 max-w-2xl text-sm text-ink-soft">Upload a PDF, assign it to a signed-in member, and review their signing record. Each contract is kept as a protected snapshot. Have counsel review your contract and electronic-consent language before assigning real participants.</p></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={create} className="rounded-2xl border border-hairline bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2"><FileUp className="size-5 text-plum"/><h2 className="font-display text-xl">1. Add a contract</h2></div>
        <label className="mt-5 block text-sm font-medium">Contract title<input className="mt-2 w-full rounded-xl border border-hairline bg-white px-3 py-3" value={title} onChange={e=>setTitle(e.target.value)} minLength={3} maxLength={200} required /></label>
        <label className="mt-4 block text-sm font-medium">PDF file<input className="mt-2 block w-full rounded-xl border border-hairline bg-white px-3 py-3" type="file" accept="application/pdf,.pdf" onChange={e=>setFile(e.target.files?.[0]??null)} required /></label>
        <p className="mt-3 text-xs text-ink-soft">PDF only, up to 10 MB. The document is copied into protected storage when you add it.</p>
        <button disabled={busy || !file || title.trim().length<3} className="mt-5 rounded-xl bg-plum px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">Add contract</button>
      </form>
      <form onSubmit={assign} className="rounded-2xl border border-hairline bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2"><FileSignature className="size-5 text-plum"/><h2 className="font-display text-xl">2. Assign to a member</h2></div>
        <label className="mt-5 block text-sm font-medium">Contract<select className="mt-2 w-full rounded-xl border border-hairline bg-white px-3 py-3" value={selected} onChange={e=>setSelected(e.target.value)} required><option value="">Choose a contract</option>{contracts.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label className="mt-4 block text-sm font-medium">Member email<input className="mt-2 w-full rounded-xl border border-hairline bg-white px-3 py-3" type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label>
        <p className="mt-3 text-xs text-ink-soft">The person needs a Boss Clinician member account to sign in and sign. Assignment does not send an email yet.</p>
        <button disabled={busy || !selected} className="mt-5 rounded-xl bg-plum px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">Assign contract</button>
      </form>
    </div>
    <section className="rounded-2xl border border-hairline bg-white p-5 shadow-sm"><h2 className="font-display text-xl">Contracts</h2>{contracts.length===0?<p className="mt-4 text-sm text-ink-soft">No contracts added yet.</p>:<div className="mt-4 grid gap-3 sm:grid-cols-2">{contracts.map(c=><div key={c.id} className="rounded-xl border border-hairline p-4"><p className="font-semibold">{c.title}</p><p className="mt-1 text-sm text-ink-soft">{c.signed_count} signed · {c.assigned_count} assigned</p><a className="mt-3 inline-block text-sm text-plum underline" href={adminContractsApi.fileUrl(c.id)} target="_blank" rel="noreferrer">View PDF</a></div>)}</div>}</section>
    <section className="rounded-2xl border border-hairline bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-plum"/><h2 className="font-display text-xl">Participant status</h2></div>{assignments.length===0?<p className="mt-4 text-sm text-ink-soft">No assignments yet.</p>:<div className="mt-4 space-y-3">{assignments.map(a=><div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline p-4"><div><p className="font-semibold">{a.member_name || a.member_email}</p><p className="text-sm text-ink-soft">{a.member_email} · {contracts.find(c=>c.id===a.contract_id)?.title}</p></div><div className="flex items-center gap-3"><span className="rounded-full bg-ink/5 px-3 py-1 text-xs font-semibold">{a.status==='signed'?'Signed':'Awaiting signature'}</span><button onClick={async()=>{ try { const data=await adminContractsApi.events(a.id); setActivity(data.events); setAuditValid(data.verification.valid); } catch(e){ toast.error(e instanceof Error?e.message:'Could not load record.'); } }} className="text-sm text-plum underline">Audit record</button></div></div>)}</div>}</section>
    {activity && <div role="dialog" aria-label="Contract audit record" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"><div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-xl"><div className="flex justify-between"><h2 className="font-display text-xl">Signing audit record</h2><button onClick={()=>setActivity(null)} aria-label="Close audit record">Close</button></div><p className={`mt-4 text-sm font-semibold ${auditValid ? "text-emerald-700" : "text-red-700"}`}>{auditValid ? "Audit hash chain verified" : "Audit record failed verification"}</p><div className="mt-4 space-y-3 text-sm">{activity.map((event,i)=><div key={i} className="rounded-lg border border-hairline p-3"><p className="font-semibold">{String(event.event_type)} · {String(event.occurred_at)}</p><p className="break-all text-xs text-ink-soft">SHA-256: {String(event.event_hash)}</p></div>)}</div></div></div>}
  </div>;
}
