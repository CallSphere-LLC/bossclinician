import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, CalendarClock, Copy, Eye, FileSignature, ListChecks, Plus, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  adminRetreatsApi,
  formatRetreatRange,
  type AdminRetreatDetail,
  type FeedbackLabels,
  type OpenMode,
  type RetreatDeadline,
  type RetreatSettings,
} from "@/lib/retreatsApi";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  legibleDisabledStyles,
} from "@/pages/admin/ui/primitives";
import { cn } from "@/lib/cn";
import { fromLocalInput, toLocalInput } from "./retreatAdminRules";
import { RetreatGuests } from "./RetreatGuests";
import { RetreatAnnouncements } from "./RetreatAnnouncements";
import { RetreatMemories } from "./RetreatMemories";
import { RetreatAlumni } from "./RetreatAlumni";
import { RetreatQuestionnaires } from "./RetreatQuestionnaires";

type TabId = "settings" | "questionnaires" | "guests" | "announcements" | "memories" | "alumni";

const TABS: { id: TabId; label: string }[] = [
  { id: "settings", label: "Overview & Settings" },
  { id: "questionnaires", label: "Questionnaires" },
  { id: "guests", label: "Guest Manager" },
  { id: "announcements", label: "Announcements" },
  { id: "memories", label: "Memories" },
  { id: "alumni", label: "Alumni & Returning Guests" },
];

/**
 * Admin › Retreats › one retreat — the private organizer view.
 *
 * Owner/admin only on the server (routes/admin/retreats.ts). Nothing on this
 * page emails a guest, grants access, or charges anyone.
 */
export default function RetreatAdmin() {
  const params = useParams();
  const id = Number(params.id);
  const [detail, setDetail] = useState<AdminRetreatDetail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabId>("settings");
  const [confirm, confirmDialog] = useConfirm();
  const [duplicating, setDuplicating] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await adminRetreatsApi.get(id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this retreat.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function togglePublished() {
    if (!detail) return;
    const next = !detail.published;
    const ok = await confirm(
      next
        ? {
            title: "Publish this retreat dashboard?",
            description:
              "Publishing lets guests who hold the dashboard product open it. It does not grant access to anyone or send any email.",
            confirmLabel: "Yes, publish",
          }
        : {
            title: "Unpublish this retreat dashboard?",
            description: "Guests will no longer be able to open the dashboard. Nothing they saved is deleted.",
            confirmLabel: "Yes, unpublish",
          },
    );
    if (!ok) return;
    try {
      setDetail(await adminRetreatsApi.setPublished(id, next));
      toast.success(next ? "Retreat dashboard published" : "Retreat dashboard unpublished");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change publication.");
    }
  }

  if (!Number.isSafeInteger(id) || id <= 0) return <div className="p-8"><ErrorNotice message="That retreat doesn't exist." /></div>;

  return (
    <div className="mx-auto max-w-6xl space-y-7 px-4 py-8 sm:px-8">
      {confirmDialog}
      <Link to="/admin/retreats" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> All retreats
      </Link>
      {error && <ErrorNotice message={error} />}
      {!detail && !error && <Skeleton className="h-40" />}
      {detail && (
        <>
          <PageHeader
            eyebrow="FlourisHealer Retreats"
            title={detail.title}
            description={`${formatRetreatRange(detail.startDate, detail.endDate)} · ${detail.location}`}
            actions={
              <>
                <Badge tone={detail.published ? "green" : "neutral"}>{detail.published ? "Published" : "Draft"}</Badge>
                <Button variant="secondary" size="sm" asChild>
                  <Link to={`/admin/retreats/${id}/preview`}>
                    <Eye aria-hidden /> Preview guest dashboard
                  </Link>
                </Button>
                {detail.courseId !== null && (
                  <Button variant="secondary" size="sm" asChild>
                    <Link to={`/admin/courses/${detail.courseId}/curriculum`}>Open course</Link>
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setDuplicating(true)}>
                  <Copy aria-hidden /> Duplicate retreat
                </Button>
                <Button size="sm" variant={detail.published ? "secondary" : "primary"} onClick={() => void togglePublished()}>
                  {detail.published ? "Unpublish" : "Publish"}
                </Button>
              </>
            }
          />

          <div role="tablist" aria-label="Retreat sections" className="flex flex-wrap gap-2 border-b border-hairline pb-3">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "min-h-10 rounded-full px-4 text-xs font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50",
                  tab === t.id ? "bg-gold/[0.14] text-gold" : "text-ink-soft hover:text-ink",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel">
            {tab === "settings" && <SettingsTab key={detail.id} detail={detail} onSaved={setDetail} />}
            {tab === "questionnaires" && <RetreatQuestionnaires retreatId={id} />}
            {tab === "guests" && <RetreatGuests retreatId={id} />}
            {tab === "announcements" && <RetreatAnnouncements retreatId={id} />}
            {tab === "memories" && <RetreatMemories retreatId={id} />}
            {tab === "alumni" && <RetreatAlumni retreatId={id} />}
          </div>
          {duplicating && <DuplicateModal detail={detail} onClose={() => setDuplicating(false)} />}
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── Duplicate retreat ─────────────────────────── */

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function DuplicateModal({ detail, onClose }: { detail: AdminRetreatDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [timezone, setTimezone] = useState(detail.timezone);
  const [airport, setAirport] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (title.trim().length < 3) return setError("Give the new retreat a title.");
    if (!SLUG.test(slug)) return setError("Use lowercase letters, numbers and single dashes for the web address, e.g. costa-rica-2028.");
    if (!startDate || !endDate) return setError("Choose the start and end dates.");
    if (endDate < startDate) return setError("The end date is before the start date.");
    setBusy(true);
    setError("");
    try {
      const created = await adminRetreatsApi.duplicate(detail.id, {
        title: title.trim(),
        slug,
        location: location.trim(),
        startDate,
        endDate,
        timezone: timezone.trim() || undefined,
        airport: airport.trim(),
      });
      toast.success("Draft retreat created");
      onClose();
      navigate(`/admin/retreats/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not duplicate the retreat.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Duplicate ${detail.title}`}
      description="Creates a new draft retreat. Nothing is published, granted or sent."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void submit()}>{busy ? "Creating…" : "Create draft retreat"}</Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-ink-soft">
          Copies this retreat's settings, checklist choices and questionnaires into a new draft retreat. Guests, answers, agreements,
          bookings, payments, announcements and photos are not copied. Shuttle windows, the group call, flight guidance, the passport
          date and deadline dates start empty. Review the copied wording before publishing: welcome, questionnaires (for example, the activities named in the health question), preparation, itinerary and inclusions.
        </p>
        {error && <ErrorNotice message={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" className="sm:col-span-2"><Input value={title} placeholder="FlourisHealer Costa Rica 2028" onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Web address" hint="e.g. costa-rica-2028; becomes /retreats/dashboard/<address>">
            <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))} />
          </Field>
          <Field label="Destination"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          <Field label="Start (arrival) date"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="End (checkout) date"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          <Field label="Time zone"><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} /></Field>
          <Field label="Airport"><Input value={airport} onChange={(e) => setAirport(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Overview & Settings ───────────────────────── */

const MODE_HINT = "Auto opens on the retreat's last day.";

function ModeSelect({ value, onChange }: { value: OpenMode; onChange: (v: OpenMode) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as OpenMode)}>
      <option value="auto">Auto (opens on the retreat's last day)</option>
      <option value="open">Open now</option>
      <option value="closed">Closed</option>
    </Select>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm text-ink">
      <input type="checkbox" className="size-4 accent-[var(--accent,#d4af37)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const LABEL_FIELDS: { key: keyof FeedbackLabels; label: string }[] = [
  { key: "rating", label: "1. Overall experience (1–5 rating)" },
  { key: "favoriteMoment", label: "2. Favorite moment" },
  { key: "appreciated", label: "3. What you appreciated most" },
  { key: "expectations", label: "4. Compared with expectations" },
  { key: "improve", label: "5. What could we improve" },
  { key: "attendAgain", label: "6. Attend a future retreat?" },
  { key: "recommend", label: "7. Recommend to a friend?" },
  { key: "testimonialText", label: "8. Optional public testimonial" },
  { key: "testimonialConsent", label: "9. Testimonial permission" },
];

function Section({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} icon={icon} />
      <div className="grid gap-4 p-5 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function SettingsTab({ detail, onSaved }: { detail: AdminRetreatDetail; onSaved: (d: AdminRetreatDetail) => void }) {
  const [title, setTitle] = useState(detail.title);
  const [location, setLocation] = useState(detail.location);
  const [startDate, setStartDate] = useState(detail.startDate);
  const [endDate, setEndDate] = useState(detail.endDate);
  const [timezone, setTimezone] = useState(detail.timezone);
  const [s, setS] = useState<RetreatSettings>(detail.settings);
  const [inclusionsText, setInclusionsText] = useState(detail.settings.inclusions.join("\n"));
  const [activitiesText, setActivitiesText] = useState(detail.settings.activities.join("\n"));
  const [busy, setBusy] = useState(false);

  const patch = <K extends keyof RetreatSettings>(key: K, value: RetreatSettings[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const setDeadline = (index: number, change: Partial<RetreatDeadline>) =>
    setS((prev) => ({ ...prev, deadlines: prev.deadlines.map((d, i) => (i === index ? { ...d, ...change } : d)) }));

  async function save() {
    setBusy(true);
    try {
      const settings: RetreatSettings = {
        ...s,
        inclusions: inclusionsText.split("\n").map((line) => line.trim()).filter(Boolean),
        activities: activitiesText.split("\n").map((line) => line.trim()).filter(Boolean),
        deadlines: s.deadlines
          .map((d) => ({ label: d.label.trim(), date: d.date || null, note: d.note.trim() }))
          .filter((d) => d.label),
      };
      const saved = await adminRetreatsApi.update(detail.id, { title, location, startDate, endDate, timezone, settings });
      onSaved(saved);
      setS(saved.settings);
      setInclusionsText(saved.settings.inclusions.join("\n"));
      setActivitiesText(saved.settings.activities.join("\n"));
      toast.success("Retreat settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Section title="Retreat" icon={<Settings2 />}>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Destination" hint="Shown to guests and used for {{destination}}"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Start (arrival) date"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <Field label="End (checkout) date"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        <Field label="Time zone" hint="Used for the countdown and the post-retreat email timing"><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} /></Field>
        <Field label="Airport"><Input value={s.airport} onChange={(e) => patch("airport", e.target.value)} /></Field>
      </Section>

      <Section title="Welcome" subtitle="What every guest sees first">
        <Field label="Dashboard title"><Input value={s.dashboardTitle} onChange={(e) => patch("dashboardTitle", e.target.value)} /></Field>
        <Field label="Support email"><Input type="email" value={s.supportEmail} onChange={(e) => patch("supportEmail", e.target.value)} /></Field>
        <Field label="Welcome message" hint="{{destination}} and {{dates}} are filled in from this retreat" className="sm:col-span-2">
          <Textarea rows={4} value={s.welcomeMessage} onChange={(e) => patch("welcomeMessage", e.target.value)} />
        </Field>
      </Section>

      <Section title="Travel" subtitle="Guest Profile and flight details are questionnaires now — edit them on the Questionnaires tab">
        <Field label="Flight guidance status">
          <Select
            value={s.flightGuidance.status}
            onChange={(e) => patch("flightGuidance", { ...s.flightGuidance, status: e.target.value as RetreatSettings["flightGuidance"]["status"] })}
          >
            <option value="researching">Researching</option>
            <option value="recommendations_available">Recommendations available</option>
            <option value="booking_encouraged">Booking encouraged</option>
          </Select>
        </Field>
        <Field label="Flight guidance note" hint="Make no airfare or route promises">
          <Textarea rows={3} value={s.flightGuidance.note} onChange={(e) => patch("flightGuidance", { ...s.flightGuidance, note: e.target.value })} />
        </Field>
        <Field label="Airport transportation note" className="sm:col-span-2">
          <Textarea rows={3} value={s.transportNote} onChange={(e) => patch("transportNote", e.target.value)} />
        </Field>
        <div className="sm:col-span-2 space-y-2 rounded-xl border border-hairline p-4">
          <Toggle checked={s.shuttle.confirmed} onChange={(v) => patch("shuttle", { ...s.shuttle, confirmed: v })} label="Shuttle windows are confirmed" />
          <Field label="Confirmed shuttle windows">
            <Textarea rows={3} value={s.shuttle.details} onChange={(e) => patch("shuttle", { ...s.shuttle, details: e.target.value })} />
          </Field>
          <p className="text-xs text-ink-soft">Until this is ticked, guests see “Details coming soon”.</p>
        </div>
      </Section>

      <Section title="Pre-trip group call" subtitle="Until confirmed, guests see “Details coming soon”">
        <div className="sm:col-span-2">
          <Toggle checked={s.groupCall.confirmed} onChange={(v) => patch("groupCall", { ...s.groupCall, confirmed: v })} label="The call details are confirmed" />
        </div>
        <Field label="Date and time"><Input type="datetime-local" value={toLocalInput(s.groupCall.startsAt)} onChange={(e) => patch("groupCall", { ...s.groupCall, startsAt: fromLocalInput(e.target.value) })} /></Field>
        <Field label="Time zone shown to guests"><Input value={s.groupCall.timezone} onChange={(e) => patch("groupCall", { ...s.groupCall, timezone: e.target.value })} /></Field>
        <Field label="Join link"><Input value={s.groupCall.joinUrl} onChange={(e) => patch("groupCall", { ...s.groupCall, joinUrl: e.target.value })} /></Field>
        <Field label="Notes"><Textarea rows={2} value={s.groupCall.notes} onChange={(e) => patch("groupCall", { ...s.groupCall, notes: e.target.value })} /></Field>
        <p className="sm:col-span-2 text-xs text-ink-soft">The date/time box uses this computer's clock; it is stored as an exact moment.</p>
      </Section>

      <Section title="Retreat details, itinerary and preparation">
        <Field label="Included (one per line)" hint="Only what the signed agreement includes">
          <Textarea rows={6} value={inclusionsText} onChange={(e) => setInclusionsText(e.target.value)} />
        </Field>
        <Field label="Planned activities (one per line)" hint="Shown under Retreat Details; leave empty to hide">
          <Textarea rows={6} value={activitiesText} onChange={(e) => setActivitiesText(e.target.value)} />
        </Field>
        <Field label="Day-by-day itinerary (Markdown)" hint="Only publish confirmed experiences" className="sm:col-span-2">
          <Textarea rows={6} value={s.itineraryMd} onChange={(e) => patch("itineraryMd", e.target.value)} />
        </Field>
        <Field label="Passport & preparation (Markdown)" hint="Date and source any entry/visa rule" className="sm:col-span-2">
          <Textarea rows={10} value={s.preparationMd} onChange={(e) => patch("preparationMd", e.target.value)} />
        </Field>
        <Field label="Recommended passport validity through">
          <Input type="date" value={s.passportValidThrough ?? ""} onChange={(e) => patch("passportValidThrough", e.target.value || null)} />
        </Field>
      </Section>

      <Card>
        <CardHeader icon={<CalendarClock />} title="Deadlines" subtitle="Shown in Important dates. A deadline without a date shows “Details coming soon”." />
        <div className="space-y-3 p-5">
          {s.deadlines.length === 0 && <p className="text-sm text-ink-soft">No deadlines yet.</p>}
          {s.deadlines.map((d, index) => (
            <div key={index} className="grid gap-3 rounded-xl border border-hairline p-3 sm:grid-cols-[1fr_11rem_1fr_auto] sm:items-end">
              <Field label="Deadline"><Input value={d.label} placeholder="e.g. Retreat Profile due" onChange={(e) => setDeadline(index, { label: e.target.value })} /></Field>
              <Field label="Date"><Input type="date" value={d.date ?? ""} onChange={(e) => setDeadline(index, { date: e.target.value || null })} /></Field>
              <Field label="Note" hint="Optional"><Input value={d.note} onChange={(e) => setDeadline(index, { note: e.target.value })} /></Field>
              <Button size="iconSm" variant="dangerGhost" aria-label="Remove deadline" onClick={() => patch("deadlines", s.deadlines.filter((_, i) => i !== index))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => patch("deadlines", [...s.deadlines, { label: "", date: null, note: "" }])}>
            <Plus aria-hidden /> Add a deadline
          </Button>
        </div>
      </Card>

      <Section title="Checklist" subtitle="Which fixed items this retreat uses (questionnaires are set on their own tab)" icon={<ListChecks />}>
        <div className="sm:col-span-2 space-y-1">
          <Toggle checked={s.checklist.passport} onChange={(v) => patch("checklist", { ...s.checklist, passport: v })} label="Passport & preparation task" />
          <Toggle checked={s.checklist.groupCall} onChange={(v) => patch("checklist", { ...s.checklist, groupCall: v })} label="Pre-trip group call" />
          <Toggle checked={s.insurance.show} onChange={(v) => patch("insurance", { show: v })} label="Show travel insurance guidance (strongly recommended, not required)" />
        </div>
      </Section>

      <Section title="After the retreat" subtitle={MODE_HINT}>
        <Field label="Memories gallery"><ModeSelect value={s.gallery.mode} onChange={(v) => patch("gallery", { ...s.gallery, mode: v })} /></Field>
        <Field label="Guest uploads"><ModeSelect value={s.gallery.uploadsMode} onChange={(v) => patch("gallery", { ...s.gallery, uploadsMode: v })} /></Field>
        <Field label="Largest photo (MB)"><Input type="number" min={1} value={s.gallery.maxPhotoMb} onChange={(e) => patch("gallery", { ...s.gallery, maxPhotoMb: Number(e.target.value) })} /></Field>
        <Field label="Largest video (MB)"><Input type="number" min={1} value={s.gallery.maxVideoMb} onChange={(e) => patch("gallery", { ...s.gallery, maxVideoMb: Number(e.target.value) })} /></Field>
        <div className="sm:col-span-2">
          <Toggle checked={s.gallery.requireReview} onChange={(v) => patch("gallery", { ...s.gallery, requireReview: v })} label="Review each guest upload before other guests can see it" />
        </div>
        <Field label="Private reflection (feedback)"><ModeSelect value={s.feedback.mode} onChange={(v) => patch("feedback", { ...s.feedback, mode: v })} /></Field>
        <Field label="Next-retreat interest"><ModeSelect value={s.interest.mode} onChange={(v) => patch("interest", { mode: v })} /></Field>
        <Field label="“Join Us Again” section" hint="Hidden unless you open it"><ModeSelect value={s.joinUsAgain.mode} onChange={(v) => patch("joinUsAgain", { ...s.joinUsAgain, mode: v })} /></Field>
        <Field label="“Join Us Again” intro"><Textarea rows={2} value={s.joinUsAgain.intro} onChange={(e) => patch("joinUsAgain", { ...s.joinUsAgain, intro: e.target.value })} /></Field>
      </Section>

      <Section title="Reflection questions" subtitle="Your wording for each question; answers already given keep their text">
        {LABEL_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} className="sm:col-span-2">
            <Input value={s.feedback.labels[f.key]} onChange={(e) => patch("feedback", { ...s.feedback, labels: { ...s.feedback.labels, [f.key]: e.target.value } })} />
          </Field>
        ))}
      </Section>

      <Card>
        <CardHeader icon={<FileSignature />} title="Bookings and agreements" subtitle="Read only — managed in Offers and Contracts" />
        <div className="grid gap-5 p-5 sm:grid-cols-2 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">Booking offers (payments are read from these)</p>
            {detail.offers.length === 0 ? (
              <p className="mt-1 text-ink-soft">None linked.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {detail.offers.map((o) => (
                  <li key={o.id}>
                    <Link className="text-plum-deep underline" to={`/admin/offers/${o.id}`}>{o.title}</Link>
                    {o.status !== "published" && <span className="text-ink-soft"> · {o.status}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">Agreement contracts (status read from signatures)</p>
            {detail.contracts.length === 0 ? (
              <p className="mt-1 text-ink-soft">None linked.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {detail.contracts.map((c) => <li key={c.id} className="text-ink">{c.title}</li>)}
              </ul>
            )}
            <p className="mt-2 text-xs text-ink-soft">These internal titles are never shown on the guest dashboard, which says “Your retreat agreement”.</p>
          </div>
          <p className="sm:col-span-2 text-xs text-ink-soft">
            Dashboard product: {detail.productSlug ?? "—"} ({detail.productStatus ?? "—"}). Guests get the dashboard only when given this product.
          </p>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button className={legibleDisabledStyles} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
