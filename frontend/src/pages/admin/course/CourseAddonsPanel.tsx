import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, ErrorNotice, Input, selectStyles } from "@/pages/admin/ui/primitives";
import { courseHubApi, type CourseAddonsData } from "./courseHubApi";

export function CourseAddonsPanel({ courseId }: { courseId: number }) {
  const [data,setData]=useState<CourseAddonsData | null>(null);
  const [offerId,setOfferId]=useState('');
  const [description,setDescription]=useState('');
  const [sort,setSort]=useState('0');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  useEffect(() => {
    let active=true;
    courseHubApi.addOns(courseId).then(value => { if(active) setData(value); })
      .catch(() => { if(active) setError('Optional add-ons could not be loaded. Refresh to try again.'); });
    return () => { active=false; };
  },[courseId]);
  async function save(event: FormEvent) {
    event.preventDefault(); if(busy || !offerId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await courseHubApi.saveAddon(courseId,{offerId:Number(offerId),description,sort:Number(sort)});
      setData(await courseHubApi.addOns(courseId));setOfferId('');setDescription('');setSort('0');setNotice('Optional add-on saved.');
    } catch(e) { setError(e instanceof Error ? e.message : 'The add-on could not be saved.'); }
    finally { setBusy(false); }
  }
  async function remove(id: number) {
    if(busy) return;setBusy(true);setError('');setNotice('');
    try { await courseHubApi.removeAddon(courseId,id);setData(await courseHubApi.addOns(courseId));setNotice('Optional add-on removed.'); }
    catch { setError('The add-on could not be removed. Please try again.'); }
    finally { setBusy(false); }
  }
  return <Card className="p-5">
    <h2 className="font-display text-lg font-semibold">Optional add-ons for students</h2>
    <p className="mt-2 text-sm text-ink-soft">Show separate purchase options inside this course. Choose an existing published offer; its checkout controls the price, terms and access after purchase. Adding a link does not include that product in this course.</p>
    <p className="mt-2 text-sm text-ink-soft">For a paid 1:1 call, configure its offer and delivery first. Unavailable offers cannot be purchased from these cards.</p>
    {error && <div className="mt-3"><ErrorNotice message={error} /></div>}
    <p role="status" className="mt-2 text-sm">{notice}</p>
    {!data ? (!error && <p className="mt-3 text-sm">Loading add-ons…</p>) : <>
      <ul className="my-4 divide-y divide-ink/10">
        {data.configured.map(item => <li key={item.offerId} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0"><p className="break-words font-medium">{item.title}</p><p className="text-xs text-ink-soft">Order {item.sort} · {item.status}</p></div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => {setOfferId(String(item.offerId));setDescription(item.description);setSort(String(item.sort));}}>Edit<span className="sr-only"> {item.title}</span></Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void remove(item.offerId)}>Remove<span className="sr-only"> {item.title}</span></Button>
          </div>
        </li>)}
      </ul>
      {!data.configured.length && <p className="mb-4 text-sm text-ink-soft">No optional add-ons configured.</p>}
      <form onSubmit={event => void save(event)} className="grid gap-3">
        <label className="grid gap-1 text-sm">Offer<select required value={offerId} onChange={event => setOfferId(event.target.value)} className={selectStyles} disabled={busy}>
          <option value="">Choose a published offer</option>
          {data.offers.map(offer => <option key={offer.id} value={offer.id}>{offer.title}</option>)}
        </select></label>
        <label className="grid gap-1 text-sm">Short description<Input maxLength={300} value={description} onChange={event => setDescription(event.target.value)} disabled={busy} /></label>
        <label className="grid gap-1 text-sm">Display order<Input type="number" min={0} max={999} required value={sort} onChange={event => setSort(event.target.value)} disabled={busy} /></label>
        <div><Button type="submit" size="sm" disabled={busy || !offerId}>{busy ? 'Saving…' : 'Save add-on'}</Button></div>
      </form>
    </>}
  </Card>;
}
