import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Eye, FileSignature, Settings2 } from "lucide-react";
import { toast } from "sonner";
import {
  adminRetreatsApi,
  formatRetreatRange,
  type AdminRetreatDetail,
  type FeedbackLabels,
  type OpenMode,
  type RetreatSettings,
} from "@/lib/retreatsApi";
import { useConfirm } from "@/pages/admin/ui/Dialog";
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

type TabId = "settings" | "guests" | "announcements" | "memories" | "alumni";

const TABS: { id: TabId; label: string }[] = [
  { id: "settings", label: "Overview & Settings" },
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
            {tab === "settings" && <SettingsTab detail={detail} onSaved={setDetail} />}
            {tab === "guests" && <RetreatGuests retreatId={id} />}
            {tab === "announcements" && <RetreatAnnouncements retreatId={id} />}
            {tab === "memories" && <RetreatMemories retreatId={id} />}
            {tab === "alumni" && <RetreatAlumni retreatId={id} />}
          </div>
        </>
      )}
    </div>
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
  const [busy, setBusy] = useState(false);

  const patch = <K extends keyof RetreatSettings>(key: K, value: RetreatSettings[K]) => setS((prev) => ({ ...prev, [key]: value }));

  async function save() {
    setBusy(true);
    try {
      const settings: RetreatSettings = {
        ...s,
        inclusions: inclusionsText.split("\n").map((line) => line.trim()).filter(Boolean),
      };
      const saved = await adminRetreatsApi.update(detail.id, { title, location, startDate, endDate, timezone, settings });
      onSaved(saved);
      setS(saved.settings);
      setInclusionsText(saved.settings.inclusions.join("\n"));
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
        <Field label="Location"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Start (arrival) date"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <Field label="End (checkout) date"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        <Field label="Time zone" hint="Used for the countdown and the post-retreat email timing"><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} /></Field>
        <Field label="Airport"><Input value={s.airport} onChange={(e) => patch("airport", e.target.value)} /></Field>
      </Section>

      <Section title="Welcome" subtitle="What every guest sees first">
        <Field label="Dashboard title"><Input value={s.dashboardTitle} onChange={(e) => patch("dashboardTitle", e.target.value)} /></Field>
        <Field label="Support email"><Input type="email" value={s.supportEmail} onChange={(e) => patch("supportEmail", e.target.value)} /></Field>
        <Field label="Welcome message" className="sm:col-span-2">
          <Textarea rows={4} value={s.welcomeMessage} onChange={(e) => patch("welcomeMessage", e.target.value)} />
        </Field>
      </Section>

      <Section title="Forms and travel" subtitle="Guest Profile and Booked Flight Tracker are still your Jotforms in Phase 1">
        <Field label="Guest Profile link (Jotform)"><Input value={s.guestProfileUrl} onChange={(e) => patch("guestProfileUrl", e.target.value)} /></Field>
        <Field label="Booked Flight Tracker link (Jotform)"><Input value={s.flightTrackerUrl} onChange={(e) => patch("flightTrackerUrl", e.target.value)} /></Field>
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
          <Toggle checked={s.shuttle.confirmed} onChange={(v) => patch("shuttle", { ...s.shuttle, confirmed: v })} label="Pickup windows are confirmed" />
          <Field label="Confirmed pickup windows">
            <Textarea rows={3} value={s.shuttle.details} onChange={(e) => patch("shuttle", { ...s.shuttle, details: e.target.value })} />
          </Field>
          <p className="text-xs text-ink-soft">Until this is ticked, guests see “to be confirmed” and never these details.</p>
        </div>
      </Section>

      <Section title="Pre-trip group call" subtitle="Unconfirmed details are never shown to guests">
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
        <Field label="Included (one per line)" hint="Only what the signed agreement includes" className="sm:col-span-2">
          <Textarea rows={6} value={inclusionsText} onChange={(e) => setInclusionsText(e.target.value)} />
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
