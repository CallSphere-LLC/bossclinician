import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, HeartHandshake, MessageSquareQuote, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { sessionFetch } from "@/lib/adminTransport";
import {
  adminRetreatsApi,
  type AdminFeedbackRow,
  type AdminInterestRow,
  type AdminOfferCard,
  type InterestChoice,
  type OfferCardStatus,
} from "@/lib/retreatsApi";
import { useConfirm } from "@/pages/admin/ui/Dialog";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Select,
  Textarea,
  chipRowStyles,
  legibleDisabledStyles,
} from "@/pages/admin/ui/primitives";
import {
  CARD_STATUS_LABEL,
  canApproveForPublication,
  cardProblem,
  consentLabel,
  consentedAttribution,
  fromLocalInput,
  toLocalInput,
} from "./retreatAdminRules";

const INTEREST_LABEL: Record<InterestChoice, string> = {
  international: "International",
  domestic_business: "Domestic Business",
  both: "Both",
  not_now: "Not at this time",
};

/** The owner-only Alumni & Returning Guest Center for one retreat. */
export function RetreatAlumni({ retreatId }: { retreatId: number }) {
  return (
    <div className="space-y-6">
      <FeedbackInbox retreatId={retreatId} />
      <InterestList retreatId={retreatId} />
      <CardsEditor retreatId={retreatId} />
    </div>
  );
}

/* ─────────────────────────────── feedback ─────────────────────────────── */

const ANSWER_LABELS: [keyof AdminFeedbackRow["answers"], string][] = [
  ["rating", "Overall rating (1–5)"],
  ["ratingWhy", "Why"],
  ["favoriteMoment", "Favorite moment"],
  ["appreciated", "Appreciated most"],
  ["expectations", "Compared with expectations"],
  ["improve", "Improve next time"],
  ["attendAgain", "Attend again"],
  ["attendAgainWhere", "Destinations / experiences"],
  ["recommend", "Recommend"],
  ["recommendWhy", "Why"],
];

function FeedbackInbox({ retreatId }: { retreatId: number }) {
  const [rows, setRows] = useState<AdminFeedbackRow[]>([]);
  const [error, setError] = useState("");
  const [state, setState] = useState<"submitted" | "draft" | "all">("submitted");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    try {
      setRows((await adminRetreatsApi.feedback(retreatId)).feedback);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load feedback.");
    }
  }, [retreatId]);
  useEffect(() => {
    void load();
  }, [load]);

  const shown = rows.filter((r) => {
    if (state !== "all" && r.state !== state) return false;
    const q = query.trim().toLowerCase();
    return !q || `${r.name} ${r.email}`.toLowerCase().includes(q);
  });

  async function setPublication(row: AdminFeedbackRow, approved: boolean) {
    if (approved) {
      const attribution = consentedAttribution(row.name, row.testimonialConsent, row.testimonialRole);
      const ok = await confirm({
        title: "Approve this testimonial for publication?",
        description: `Use her exact words only, attributed as “${attribution ?? ""}”. Approving does not publish anything by itself.`,
        confirmLabel: "Yes, approve",
      });
      if (!ok) return;
    }
    try {
      const updated = await adminRetreatsApi.setPublication(retreatId, row.id, approved);
      setRows((all) => all.map((r) => (r.id === row.id ? updated : r)));
      toast.success(approved ? "Approved for publication" : "Approval withdrawn");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the approval.");
    }
  }

  return (
    <Card>
      {confirmDialog}
      <CardHeader icon={<MessageSquareQuote />} title="Private feedback inbox" subtitle="Reflections are private. Nothing is published automatically." />
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <div className={chipRowStyles}>
          <Chip selected={state === "submitted"} onClick={() => setState("submitted")}>Submitted</Chip>
          <Chip selected={state === "draft"} onClick={() => setState("draft")}>Drafts</Chip>
          <Chip selected={state === "all"} onClick={() => setState("all")}>All</Chip>
        </div>
        <Input className="max-w-xs" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search feedback" />
      </div>
      {error && <div className="p-5"><ErrorNotice message={error} /></div>}
      {shown.length === 0 ? (
        <EmptyState icon={<MessageSquareQuote />} title="No reflections here yet" />
      ) : (
        <ul className="divide-y divide-hairline/60">
          {shown.map((row) => {
            const approvable = canApproveForPublication(row);
            return (
              <li key={row.id} className="p-5 text-sm">
                <button type="button" className="flex w-full flex-wrap items-center justify-between gap-3 text-left" onClick={() => setOpen(open === row.id ? null : row.id)} aria-expanded={open === row.id}>
                  <span>
                    <span className="font-semibold text-ink">{row.name || row.email}</span>
                    <span className="ml-2 text-xs text-ink-soft">{row.email}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {row.rating !== null && <span className="font-sans font-bold tabular-nums text-ink">{row.rating}/5</span>}
                    <Badge tone={row.state === "submitted" ? "green" : "neutral"}>{row.state}</Badge>
                    {row.approvedForPublicationAt && <Badge tone="gold">Approved for publication</Badge>}
                  </span>
                </button>
                {open === row.id && (
                  <div className="mt-3 space-y-3">
                    <dl className="grid gap-2 sm:grid-cols-2">
                      {ANSWER_LABELS.map(([key, label]) => {
                        const value = row.answers[key];
                        if (value === undefined || value === "") return null;
                        return (
                          <div key={key}>
                            <dt className="text-xs text-ink-soft">{label}</dt>
                            <dd className="whitespace-pre-wrap break-words text-ink">{String(value)}</dd>
                          </div>
                        );
                      })}
                    </dl>
                    <div className="rounded-xl border border-hairline p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">Optional public testimonial</p>
                      <p className="mt-1 whitespace-pre-wrap text-ink">{row.testimonialText || "None given."}</p>
                      <p className="mt-2 text-xs text-ink-soft">Permission: {consentLabel(row.testimonialConsent)}{row.testimonialRole ? ` (role: ${row.testimonialRole})` : ""}</p>
                      {approvable && <p className="text-xs text-ink-soft">Attribution if used: {consentedAttribution(row.name, row.testimonialConsent, row.testimonialRole)}</p>}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {row.approvedForPublicationAt ? (
                          <Button size="sm" variant="secondary" onClick={() => void setPublication(row, false)}>Withdraw approval</Button>
                        ) : (
                          <Button size="sm" className={legibleDisabledStyles} disabled={!approvable} onClick={() => void setPublication(row, true)}>Approve for publication</Button>
                        )}
                        {!approvable && !row.approvedForPublicationAt && (
                          <span className="text-xs text-ink-soft">Needs a submitted reflection, a testimonial and her explicit permission.</span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-ink-soft">
                      {row.submittedAt ? `Submitted ${new Date(row.submittedAt).toLocaleString()} · ` : ""}Last saved {new Date(row.updatedAt).toLocaleString()}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ─────────────────────────────── interest ─────────────────────────────── */

function InterestList({ retreatId }: { retreatId: number }) {
  const [rows, setRows] = useState<AdminInterestRow[]>([]);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    adminRetreatsApi
      .interest(retreatId)
      .then((d) => setRows(d.interest))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load interest."));
  }, [retreatId]);

  const counts = useMemo(() => {
    const c: Record<InterestChoice, number> = { international: 0, domestic_business: 0, both: 0, not_now: 0 };
    for (const r of rows) c[r.interest] += 1;
    return c;
  }, [rows]);
  const optedIn = rows.filter((r) => r.marketingOptIn).length;

  async function exportCsv() {
    setDownloading(true);
    try {
      const response = await sessionFetch(adminRetreatsApi.alumniCsvUrl(retreatId));
      if (!response.ok) throw new Error("Could not export the list.");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `retreat-${retreatId}-alumni.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export the list.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<HeartHandshake />}
        title="Next-retreat interest and marketing consent"
        subtitle="Visible only to you. Past attendance is not consent to marketing."
        action={
          <Button size="sm" variant="secondary" disabled={downloading} onClick={() => void exportCsv()}>
            <Download aria-hidden /> Export CSV
          </Button>
        }
      />
      {error && <div className="p-5"><ErrorNotice message={error} /></div>}
      <dl className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-5">
        {(Object.keys(INTEREST_LABEL) as InterestChoice[]).map((k) => (
          <div key={k}>
            <dt className="text-xs text-ink-soft">{INTEREST_LABEL[k]}</dt>
            <dd className="font-sans text-lg font-bold tabular-nums text-ink">{counts[k]}</dd>
          </div>
        ))}
        <div>
          <dt className="text-xs text-ink-soft">Marketing opt-in</dt>
          <dd className="font-sans text-lg font-bold tabular-nums text-ink">{optedIn}</dd>
        </div>
      </dl>
      {rows.length > 0 && (
        <div className="overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.08em] text-ink-soft">
              <tr className="border-b border-hairline">
                <th className="py-2 font-semibold">Guest</th>
                <th className="py-2 font-semibold">Interest</th>
                <th className="py-2 font-semibold">Destinations</th>
                <th className="py-2 font-semibold">Marketing opt-in</th>
                <th className="py-2 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.memberId} className="border-b border-hairline/60">
                  <td className="py-2"><p className="text-ink">{r.name || r.email}</p><p className="text-xs text-ink-soft">{r.email}</p></td>
                  <td className="py-2">{INTEREST_LABEL[r.interest]}</td>
                  <td className="py-2 text-ink-soft">{r.destinations || "—"}</td>
                  <td className="py-2">{r.marketingOptIn ? <Badge tone="green">Yes</Badge> : <Badge tone="neutral">No</Badge>}</td>
                  <td className="py-2 text-xs text-ink-soft">{new Date(r.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────────── Join Us Again ────────────────────────── */

type CardDraft = Omit<AdminOfferCard, "id"> & { id?: number };

const EMPTY_CARD: CardDraft = {
  title: "",
  kind: "domestic_business",
  destination: "",
  datesText: "",
  description: "",
  imageUrl: "",
  status: "draft",
  ctaLabel: "",
  ctaUrl: "",
  visible: false,
  displayFrom: null,
  displayUntil: null,
  bookedProductId: null,
  sort: 0,
};

function CardsEditor({ retreatId }: { retreatId: number }) {
  const [cards, setCards] = useState<AdminOfferCard[]>([]);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    try {
      setCards((await adminRetreatsApi.cards(retreatId)).cards);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the cards.");
    }
  }, [retreatId]);
  useEffect(() => {
    void load();
  }, [load]);

  const problem = draft ? cardProblem(draft) : null;

  async function save() {
    if (!draft || problem) return;
    setBusy(true);
    try {
      await adminRetreatsApi.saveCard(retreatId, draft);
      toast.success("Card saved");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the card.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(card: AdminOfferCard) {
    if (!(await confirm({ title: `Delete “${card.title}”?`, confirmLabel: "Yes, delete it", destructive: true }))) return;
    try {
      await adminRetreatsApi.deleteCard(retreatId, card.id);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the card.");
    }
  }

  return (
    <Card>
      {confirmDialog}
      <CardHeader
        icon={<Sparkles />}
        title="“Join Us Again” cards"
        subtitle="Never enter dates, prices or availability that aren't confirmed. Use Interest List until registration is real."
        action={!draft && <Button size="sm" onClick={() => setDraft({ ...EMPTY_CARD })}>New card</Button>}
      />
      {error && <div className="p-5"><ErrorNotice message={error} /></div>}
      {draft && (
        <div className="grid gap-4 border-b border-hairline p-5 sm:grid-cols-2">
          <Field label="Title"><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
          <Field label="Kind">
            <Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as CardDraft["kind"] })}>
              <option value="international">International</option>
              <option value="domestic_business">Domestic business</option>
            </Select>
          </Field>
          <Field label="Destination" hint="Only once confirmed"><Input value={draft.destination} onChange={(e) => setDraft({ ...draft, destination: e.target.value })} /></Field>
          <Field label="Dates" hint="Only once confirmed"><Input value={draft.datesText} onChange={(e) => setDraft({ ...draft, datesText: e.target.value })} /></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          <Field label="Image URL (optional)"><Input value={draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as OfferCardStatus })}>
              {(Object.keys(CARD_STATUS_LABEL) as OfferCardStatus[]).map((s) => <option key={s} value={s}>{CARD_STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="Button label"><Input value={draft.ctaLabel} placeholder={draft.status === "interest_list" ? "Get first access" : ""} onChange={(e) => setDraft({ ...draft, ctaLabel: e.target.value })} /></Field>
          <Field label="Button link" hint={draft.status === "registration_open" ? "Required — a verified booking page" : "Optional"}>
            <Input value={draft.ctaUrl} onChange={(e) => setDraft({ ...draft, ctaUrl: e.target.value })} />
          </Field>
          <Field label="Booking product id (optional)" hint="Guests holding it see “You're booked” instead of the button">
            <Input
              type="number"
              min={1}
              value={draft.bookedProductId ?? ""}
              onChange={(e) => setDraft({ ...draft, bookedProductId: e.target.value ? Number(e.target.value) : null })}
            />
          </Field>
          <Field label="Order"><Input type="number" value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: Number(e.target.value) || 0 })} /></Field>
          <Field label="Show from (optional)"><Input type="datetime-local" value={toLocalInput(draft.displayFrom)} onChange={(e) => setDraft({ ...draft, displayFrom: fromLocalInput(e.target.value) })} /></Field>
          <Field label="Show until (optional)"><Input type="datetime-local" value={toLocalInput(draft.displayUntil)} onChange={(e) => setDraft({ ...draft, displayUntil: fromLocalInput(e.target.value) })} /></Field>
          <label className="flex min-h-10 items-center gap-3 text-sm text-ink sm:col-span-2">
            <input type="checkbox" className="size-4" checked={draft.visible} onChange={(e) => setDraft({ ...draft, visible: e.target.checked })} />
            Visible to guests (also needs the “Join Us Again” section open in Settings; Draft cards never show)
          </label>
          {problem && <p className="text-sm text-red-300 sm:col-span-2" role="alert">{problem}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Button className={legibleDisabledStyles} disabled={busy || problem !== null} onClick={() => void save()}>Save card</Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {cards.length === 0 && !draft ? (
        <EmptyState icon={<Sparkles />} title="No cards" description="The section stays hidden from guests until you add a card and open it." />
      ) : (
        <ul className="divide-y divide-hairline/60">
          {cards.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 p-5 text-sm">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">{c.title}</p>
                  <Badge tone={c.status === "registration_open" ? "green" : c.status === "draft" ? "neutral" : "gold"}>{CARD_STATUS_LABEL[c.status]}</Badge>
                  <Badge tone={c.visible ? "green" : "neutral"}>{c.visible ? "Visible" : "Hidden"}</Badge>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{[c.kind === "international" ? "International" : "Domestic business", c.destination, c.datesText].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDraft({ ...c })}>Edit</Button>
                <Button size="sm" variant="dangerGhost" onClick={() => void remove(c)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
