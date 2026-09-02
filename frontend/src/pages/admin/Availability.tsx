import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarClock, Clock3, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type {
  AvailabilityOverride,
  AvailabilityPreview,
  AvailabilityRule,
} from "@/types/admin";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  selectStyles,
  Skeleton,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError } from "@/pages/admin/ui/friendly";
import { wallClockToIso } from "@/lib/zonedDateTime";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function minutesToClock(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function clockToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export default function Availability() {
  const [rules, setRules] = useState<AvailabilityRule[] | null>(null);
  const [overrides, setOverrides] = useState<AvailabilityOverride[] | null>(null);
  const [preview, setPreview] = useState<AvailabilityPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState({ weekday: 1, start: "09:00", end: "17:00" });
  const [ruleOpen, setRuleOpen] = useState(false);
  const [exception, setException] = useState({ startsAt: "", endsAt: "", available: false, note: "" });
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    try {
      const [ruleResult, overrideResult, previewResult] = await Promise.all([
        adminApi.availabilityRules(),
        adminApi.availabilityOverrides(),
        adminApi.availabilityPreview(),
      ]);
      setRules(ruleResult.rules);
      setOverrides(overrideResult.overrides);
      setPreview(previewResult);
      setError(null);
    } catch {
      setError("We couldn't load coaching availability. Try refreshing the page.");
    }
  }, []);

  useEffect(() => void load(), [load]);

  const byDay = useMemo(
    () => WEEKDAYS.map((_, weekday) => (rules ?? []).filter((rule) => rule.weekday === weekday)),
    [rules],
  );

  async function addRule(event: FormEvent) {
    event.preventDefault();
    const startMinute = clockToMinutes(ruleDraft.start);
    const endMinute = clockToMinutes(ruleDraft.end);
    if (endMinute <= startMinute) {
      toast.error("The end time must be after the start time.");
      return;
    }
    setBusy(true);
    try {
      await adminApi.availabilityRuleCreate({
        timezone: preview?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        weekday: ruleDraft.weekday,
        startMinute,
        endMinute,
        active: true,
      });
      setRuleOpen(false);
      toast.success(`${WEEKDAYS[ruleDraft.weekday]} availability added`);
      await load();
    } catch (err) {
      toast.error(friendlyError(err, "availability"));
    } finally {
      setBusy(false);
    }
  }

  async function addException(event: FormEvent) {
    event.preventDefault();
    const timezone = preview?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const startsAt = wallClockToIso(exception.startsAt, timezone);
    const endsAt = wallClockToIso(exception.endsAt, timezone);
    if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
      toast.error("The exception needs an end time after its start time.");
      return;
    }
    setBusy(true);
    try {
      await adminApi.availabilityOverrideCreate({ ...exception, startsAt, endsAt });
      setExceptionOpen(false);
      setException({ startsAt: "", endsAt: "", available: false, note: "" });
      toast.success(exception.available ? "Extra availability added" : "Time blocked off");
      await load();
    } catch (err) {
      toast.error(friendlyError(err, "exception"));
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(rule: AvailabilityRule) {
    if (!(await confirm({
      title: `Remove ${rule.label}?`,
      description: "Existing appointments stay booked. Clients just stop seeing this window.",
      confirmLabel: "Remove window",
      destructive: true,
    }))) return;
    try {
      await adminApi.availabilityRuleDelete(rule.id);
      toast.success("Availability removed");
      await load();
    } catch (err) {
      toast.error(friendlyError(err, "availability"));
    }
  }

  async function removeException(item: AvailabilityOverride) {
    if (!(await confirm({
      title: "Remove this calendar exception?",
      description: item.label,
      confirmLabel: "Remove exception",
      destructive: true,
    }))) return;
    try {
      await adminApi.availabilityOverrideDelete(item.id);
      toast.success("Exception removed");
      await load();
    } catch (err) {
      toast.error(friendlyError(err, "exception"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Coaching availability"
        description="Set the hours clients can book and preview the exact appointment times they will see."
        actions={<Button size="sm" onClick={() => setExceptionOpen(true)}><Plus />Add exception</Button>}
      />
      {error && <ErrorNotice message={error} />}

      {preview && (
        <Card className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <Policy label="Timezone" value={preview.timezone} />
          <Policy label="Slot frequency" value={`Every ${preview.policy.slotIntervalMinutes} minutes`} />
          <Policy label="Advance notice" value={`${preview.policy.minimumNoticeHours} hours`} />
          <Policy label="Booking window" value={`${preview.policy.bookingHorizonDays} days ahead`} />
        </Card>
      )}

      <Card>
        <CardHeader
          icon={<CalendarClock />}
          title="Weekly hours"
          subtitle="Add more than one window to a day when you take a break between sessions."
          action={<Button size="sm" onClick={() => setRuleOpen(true)}><Plus />Add hours</Button>}
        />
        {rules === null ? <div className="p-5"><Skeleton className="h-72 w-full" /></div> : (
          <div className="divide-y divide-hairline/60">
            {WEEKDAYS.map((day, weekday) => (
              <div key={day} className="grid min-h-14 gap-3 px-5 py-3 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
                <p className="text-sm font-semibold text-ink">{day}</p>
                <div className="flex flex-wrap gap-2">
                  {byDay[weekday].length === 0 ? <span className="text-sm text-ink-soft">No availability</span> : byDay[weekday].map((rule) => (
                    <span key={rule.id} className="inline-flex items-center gap-2 rounded-lg border border-hairline bg-white/[0.04] px-3 py-1.5 text-sm text-ink">
                      <Clock3 className="size-3.5 text-gold" />
                      {minutesToClock(rule.startMinute)}–{minutesToClock(rule.endMinute)}
                      <button type="button" aria-label={`Remove ${rule.label}`} onClick={() => void removeRule(rule)} className="ml-1 rounded p-1 text-ink-soft hover:bg-red-500/10 hover:text-red-300"><Trash2 className="size-3.5" /></button>
                    </span>
                  ))}
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setRuleDraft((old) => ({ ...old, weekday })); setRuleOpen(true); }}>Add</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Date exceptions" subtitle="Block a holiday or open extra hours on one date." />
          {overrides === null ? <div className="p-5"><Skeleton className="h-40 w-full" /></div> : overrides.length === 0 ? (
            <EmptyState icon={<CalendarClock />} title="No exceptions" description="Your weekly hours apply without any date-specific changes." action={<Button size="sm" onClick={() => setExceptionOpen(true)}>Add exception</Button>} />
          ) : (
            <ul className="divide-y divide-hairline/60">
              {overrides.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span><span className="flex items-center gap-2 text-sm font-medium text-ink"><Badge tone={item.available ? "green" : "slate"}>{item.available ? "Extra" : "Blocked"}</Badge>{item.label}</span>{item.note && <span className="mt-1 block text-xs text-ink-soft">{item.note}</span>}</span>
                <Button variant="dangerGhost" size="iconSm" aria-label="Remove exception" onClick={() => void removeException(item)}><Trash2 /></Button>
              </li>)}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Client preview" subtitle="The next bookable 60-minute sessions, after notice rules and existing bookings." />
          {!preview ? <div className="p-5"><Skeleton className="h-40 w-full" /></div> : preview.slots.length === 0 ? (
            <EmptyState icon={<Clock3 />} title="No upcoming slots" description="Add weekly hours or remove a blocking exception to open the calendar." />
          ) : (
            <ul className="max-h-80 divide-y divide-hairline/60 overflow-y-auto">
              {preview.slots.slice(0, 30).map((slot) => <li key={slot.startsAt} className="flex items-center justify-between px-5 py-3 text-sm"><span className="font-medium text-ink">{slot.dayLabel}</span><span className="text-ink-soft">{slot.timeLabel}</span></li>)}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={ruleOpen} onOpenChange={setRuleOpen} title="Add weekly hours" size="sm" footer={<><Button variant="secondary" size="sm" onClick={() => setRuleOpen(false)}>Cancel</Button><Button size="sm" type="submit" form="availability-rule" disabled={busy}>{busy ? "Adding…" : "Add hours"}</Button></>}>
        <form id="availability-rule" onSubmit={addRule} className="space-y-4">
          <Field label="Day"><select className={selectStyles} value={ruleDraft.weekday} onChange={(e) => setRuleDraft((old) => ({ ...old, weekday: Number(e.target.value) }))}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Starts"><Input type="time" value={ruleDraft.start} onChange={(e) => setRuleDraft((old) => ({ ...old, start: e.target.value }))} required /></Field><Field label="Ends"><Input type="time" value={ruleDraft.end} onChange={(e) => setRuleDraft((old) => ({ ...old, end: e.target.value }))} required /></Field></div>
        </form>
      </Modal>

      <Modal open={exceptionOpen} onOpenChange={setExceptionOpen} title="Add a date exception" size="sm" footer={<><Button variant="secondary" size="sm" onClick={() => setExceptionOpen(false)}>Cancel</Button><Button size="sm" type="submit" form="availability-exception" disabled={busy}>{busy ? "Saving…" : "Save exception"}</Button></>}>
        <form id="availability-exception" onSubmit={addException} className="space-y-4">
          <Field label="What should happen?"><select className={selectStyles} value={exception.available ? "available" : "blocked"} onChange={(e) => setException((old) => ({ ...old, available: e.target.value === "available" }))}><option value="blocked">Block this time</option><option value="available">Offer extra availability</option></select></Field>
          <Field label="Starts"><Input type="datetime-local" value={exception.startsAt} onChange={(e) => setException((old) => ({ ...old, startsAt: e.target.value }))} required /></Field>
          <Field label="Ends"><Input type="datetime-local" value={exception.endsAt} onChange={(e) => setException((old) => ({ ...old, endsAt: e.target.value }))} required /></Field>
          <Field label="Note" hint="optional"><Input value={exception.note} onChange={(e) => setException((old) => ({ ...old, note: e.target.value }))} placeholder="Holiday, conference…" /></Field>
        </form>
      </Modal>
      {confirmDialog}
    </div>
  );
}

function Policy({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">{label}</p><p className="mt-1 break-words text-sm font-semibold text-ink">{value}</p></div>;
}
