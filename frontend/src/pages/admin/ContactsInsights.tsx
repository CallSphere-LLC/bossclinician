import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowLeft, MailCheck, ShoppingBag, Users } from "lucide-react";
import { contactsApi, type ContactInsights } from "@/lib/contactsApi";
import { Card, ErrorNotice, PageHeader, Skeleton } from "@/pages/admin/ui/primitives";

function Metric({ label, value, detail, icon, to, linkLabel = "View list" }: { label: string; value: number; detail: string; icon: ReactNode; to: string; linkLabel?: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-soft">{label}</p>
          <p className="mt-2 font-display text-3xl text-ink">{value.toLocaleString()}</p>
          <p className="mt-1 text-sm text-ink-soft">{detail}</p>
        </div>
        <span className="grid size-10 place-items-center rounded-xl bg-plum/10 text-plum">{icon}</span>
      </div>
      <Link to={to} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-plum hover:underline">
        {linkLabel}
      </Link>
    </Card>
  );
}

function Row({ label, value, hint, to }: { label: string; value: number; hint?: string; to: string }) {
  return (
    <Link to={to} className="flex min-h-12 items-center justify-between gap-4 border-b border-hairline/60 py-3 hover:text-plum last:border-0">
      <div><p className="text-sm font-medium text-ink">{label}</p>{hint && <p className="text-xs text-ink-soft">{hint}</p>}</div>
      <span className="font-display text-xl text-ink">{value.toLocaleString()}</span>
    </Link>
  );
}

export default function ContactsInsights() {
  const [data, setData] = useState<ContactInsights | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    contactsApi.insights().then(setData).catch(() => setError("We couldn't calculate your list health. Try refreshing the page."));
  }, []);

  return (
    <div className="space-y-6">
      <Link to="/admin/contacts" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink-soft hover:text-ink"><ArrowLeft className="size-4" />People</Link>
      <PageHeader eyebrow="Contacts" title="Insights" description="Who is joining, buying and still engaging with your emails." />
      {error && <ErrorNotice message={error} />}
      {!data ? <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-44" /><Skeleton className="h-44" /><Skeleton className="h-44" /></div> : <>
        <div className="grid gap-4 md:grid-cols-3">
          <Metric label="Contacts" value={data.contacts} detail={`${data.newContacts.toLocaleString()} new in the last 30 days`} icon={<Users className="size-5" />} to="/admin/contacts?audience=new" linkLabel="View new contacts" />
          <Metric label="Subscribed" value={data.subscribed} detail={`${data.newSubscribers.toLocaleString()} newly subscribed`} icon={<MailCheck className="size-5" />} to="/admin/contacts?audience=subscribed" />
          <Metric label="Customers" value={data.customers} detail={`${data.newCustomers.toLocaleString()} bought in the last 30 days`} icon={<ShoppingBag className="size-5" />} to="/admin/contacts?audience=customer" />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-5"><h2 className="font-display text-xl text-ink">People no longer receiving marketing</h2><div className="mt-3"><Row label="Unsubscribed by you" value={data.manuallyUnsubscribed} to="/admin/contacts?optOut=manual" /><Row label="Opted out themselves" value={data.optedOut} to="/admin/contacts?optOut=self" /><Row label="Email bounced" value={data.bounced} to="/admin/contacts?status=bounced" /><Row label="Marked as spam" value={data.complained} to="/admin/contacts?status=complained" /><Row label="Never confirmed" value={data.neverSubscribed} to="/admin/contacts?status=unconfirmed" /></div></Card>
          <Card className="p-5"><div className="flex items-center gap-2"><Activity className="size-5 text-plum" /><h2 className="font-display text-xl text-ink">Subscriber engagement</h2></div><div className="mt-3"><Row label="Healthy" hint="Opened or clicked in the last 90 days" value={data.engagement.healthy} to="/admin/contacts?engagement=healthy" /><Row label="Passive" hint="Last engaged 91–180 days ago" value={data.engagement.passive} to="/admin/contacts?engagement=passive" /><Row label="Unengaged" hint="Last engaged 181–270 days ago" value={data.engagement.unengaged} to="/admin/contacts?engagement=unengaged" /><Row label="Inactive" hint="No engagement for more than 270 days" value={data.engagement.inactive} to="/admin/contacts?engagement=inactive" /></div></Card>
        </div>
      </>}
    </div>
  );
}
