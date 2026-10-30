import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { FileSignature, FileUp, ShieldCheck, ShoppingBag } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { adminContractsApi, type Contract, type ContractAssignment } from '@/lib/contractsApi';
import { CheckoutSignaturesSection } from '@/pages/admin/OfferCheckoutRequirements';
import { Modal } from '@/pages/admin/ui/Dialog';
import { Badge, Button, Card, CardHeader, ErrorNotice, Field, Input, Select, legibleDisabledStyles } from '@/pages/admin/ui/primitives';

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
    <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-soft">Coaching</p><h1 className="mt-2 font-display text-3xl text-ink">Participant contracts</h1><p className="mt-2 max-w-2xl text-sm text-ink-soft">Upload a PDF, assign it to a signed-in member, and review their signing record. Each contract is kept as a protected snapshot. Have counsel review your contract and electronic-consent language before assigning real participants.</p><p className="mt-2 max-w-2xl text-sm text-ink-soft">To ask everyone who buys an offer to sign, open the offer in Sales → Offers, go to its <strong>Contract</strong> tab, tick the contract and press Save contracts. Buyers are then assigned it automatically.</p></div>
    {error && <ErrorNotice message={error} />}
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader icon={<FileUp />} title="1. Add a contract" />
        <form onSubmit={create} className="space-y-4 p-5">
          <Field label="Contract title"><Input value={title} onChange={e=>setTitle(e.target.value)} minLength={3} maxLength={200} required /></Field>
          <Field label="PDF file"><Input className="h-auto py-2.5 file:mr-3 file:rounded-lg file:border-0 file:bg-sand file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink" type="file" accept="application/pdf,.pdf" onChange={e=>setFile(e.target.files?.[0]??null)} required /></Field>
          <p className="text-xs text-ink-soft">PDF only, up to 10 MB. The document is copied into protected storage when you add it.</p>
          <Button className={legibleDisabledStyles} disabled={busy || !file || title.trim().length<3}>Add contract</Button>
        </form>
      </Card>
      <Card>
        <CardHeader icon={<FileSignature />} title="2. Assign to a member" />
        <form onSubmit={assign} className="space-y-4 p-5">
          <Field label="Contract"><Select value={selected} onChange={e=>setSelected(e.target.value)} required><option value="">Choose a contract</option>{contracts.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</Select></Field>
          <Field label="Member email"><Input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></Field>
          <p className="text-xs text-ink-soft">The person needs a Boss Clinician member account to sign in and sign. They get a notice in their account and an email with a link to sign.</p>
          <Button className={legibleDisabledStyles} disabled={busy || !selected}>Assign contract</Button>
        </form>
      </Card>
    </div>
    <Card>
      <CardHeader title="Contracts" />
      <div className="p-5">{contracts.length===0?<p className="text-sm text-ink-soft">No contracts added yet.</p>:<div className="grid gap-3 sm:grid-cols-2">{contracts.map(c=><div key={c.id} className="rounded-xl border border-hairline p-4"><p className="font-semibold text-ink">{c.title}</p><p className="mt-1 text-sm text-ink-soft">{c.signed_count} signed · {c.assigned_count} assigned</p><div className="mt-2 text-sm"><p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft"><ShoppingBag className="size-3.5"/>Assigned on purchase of</p>{c.offers && c.offers.length>0?<ul className="mt-1 space-y-0.5">{c.offers.map(o=><li key={o.id}><Link className="text-plum-deep underline" to={`/admin/offers/${o.id}`}>{o.title}</Link>{o.status!=='published'&&<span className="text-ink-soft"> · not live</span>}</li>)}</ul>:<p className="mt-1 text-xs text-ink-soft">No offer yet. Link one from the offer’s Contract tab.</p>}</div><a className="mt-3 inline-block text-sm text-plum-deep underline" href={adminContractsApi.fileUrl(c.id)} target="_blank" rel="noreferrer">View PDF</a></div>)}</div>}</div>
    </Card>
    <Card>
      <CardHeader icon={<ShieldCheck />} title="Participant status" />
      <div className="p-5">{assignments.length===0?<p className="text-sm text-ink-soft">No assignments yet.</p>:<div className="space-y-3">{assignments.map(a=><div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline p-4"><div><p className="font-semibold text-ink">{a.member_name || a.member_email}</p><p className="text-sm text-ink-soft">{a.member_email} · {contracts.find(c=>c.id===a.contract_id)?.title}</p>{a.source_offer_title&&<p className="text-xs text-ink-soft">Assigned automatically with the purchase of {a.source_offer_title}</p>}</div><div className="flex items-center gap-3"><Badge tone={a.status==='signed'?'green':'neutral'}>{a.status==='signed'?'Signed':'Awaiting signature'}</Badge><button onClick={async()=>{ try { const data=await adminContractsApi.events(a.id); setActivity(data.events); setAuditValid(data.verification.valid); } catch(e){ toast.error(e instanceof Error?e.message:'Could not load record.'); } }} className="text-sm text-plum-deep underline">Audit record</button></div></div>)}</div>}</div>
    </Card>
    <CheckoutSignaturesSection />
    <Modal open={activity!==null} onOpenChange={open=>{ if (!open) setActivity(null); }} title="Signing audit record" size="lg">
      <p className={`text-sm font-semibold ${auditValid ? "text-emerald-300" : "text-red-300"}`}>{auditValid ? "Audit hash chain verified" : "Audit record failed verification"}</p>
      <div className="mt-4 space-y-3 text-sm">{(activity ?? []).map((event,i)=><div key={i} className="rounded-lg border border-hairline p-3"><p className="font-semibold text-ink">{String(event.event_type)} · {String(event.occurred_at)}</p><p className="break-all text-xs text-ink-soft">SHA-256: {String(event.event_hash)}</p></div>)}</div>
    </Modal>
  </div>;
}
