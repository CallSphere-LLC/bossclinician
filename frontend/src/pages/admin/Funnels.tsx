import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useSearchParams } from "react-router";
import { motion } from "motion/react";
import {
  ArrowDown,
  Bold,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Italic,
  Link2,
  List,
  Plus,
  Split,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { adminCommerceApi, type Offer } from "@/lib/adminCommerceApi";
import type { Funnel, FunnelStep } from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
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
  Textarea,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import {
  PUBLISH_LABEL,
  friendlyError,
  shareLink,
  slugify,
  uniqueKey,
  webAddressLabel,
} from "@/pages/admin/ui/friendly";

/**
 * What a stage is for.
 *
 * `value` is the string already stored against every saved stage and must not
 * change; the label and the hint are the only parts she reads, and they say
 * what the page does rather than naming a marketing pattern.
 */
const STAGE_TYPES: { value: string; label: string; hint: string }[] = [
  { value: "landing", label: "Landing page", hint: "the first page people arrive on" },
  { value: "opt_in", label: "Sign-up page", hint: "where they give you their email address" },
  { value: "offer", label: "Your offer", hint: "where you make the offer" },
  { value: "upsell", label: "Extra offer", hint: "an add-on once they've said yes" },
  { value: "thank_you", label: "Thank-you page", hint: "what they see once they're done" },
];

/** Never falls back to the stored value — "thank_you" is not a thing she typed. */
function stageTypeLabel(value: string): string {
  return STAGE_TYPES.find((t) => t.value === value)?.label ?? "Page";
}

function stageTypeHint(value: string): string {
  return STAGE_TYPES.find((t) => t.value === value)?.hint ?? "";
}

const FUNNEL_KINDS: { value: string; label: string }[] = [
  { value: "opt_in", label: "Collecting email addresses" },
  { value: "webinar", label: "Filling a webinar" },
  { value: "sales", label: "Selling something" },
  { value: "launch", label: "Running a launch" },
];

const BLUEPRINT_SUMMARY: Record<string, string> = {
  opt_in: "3 pages, a sign-up form, a joined tag and a welcome email",
  webinar: "4 pages, a registration form, a joined tag and 3 reminder/replay emails",
  sales: "3 pages, a sign-up form, a joined tag and a customer welcome email",
  launch: "4 pages, a waitlist form, a joined tag and a 4-email launch sequence",
};

/* ------------------------------------------------------- formatting toolbar */

type FormatKind = "bold" | "italic" | "bullets" | "link";

/**
 * Works out the new body text (and where to leave the cursor) for one
 * formatting button.
 *
 * The body is stored as Markdown because that's what the public page renders,
 * but she should never have to type a single asterisk: the buttons write the
 * marks around whatever she has selected, and re-select her own words
 * afterwards so she can carry on typing.
 */
function applyFormat(
  el: HTMLTextAreaElement,
  kind: FormatKind,
): { value: string; start: number; end: number } {
  const { value, selectionStart: from, selectionEnd: to } = el;
  const selected = value.slice(from, to);

  if (kind === "bullets") {
    // Bullets are a line thing, so the whole line the cursor sits on gets
    // marked even when nothing is selected.
    const lineStart = value.lastIndexOf("\n", from - 1) + 1;
    const block = value.slice(lineStart, to) || "First point";
    const bulleted = block
      .split("\n")
      .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
      .join("\n");
    return {
      value: value.slice(0, lineStart) + bulleted + value.slice(to),
      start: lineStart,
      end: lineStart + bulleted.length,
    };
  }

  if (kind === "link") {
    const text = selected || "the words people click";
    const inserted = `[${text}](https://)`;
    return {
      value: value.slice(0, from) + inserted + value.slice(to),
      // Land on the address so she can paste straight over the placeholder.
      start: from + text.length + 3,
      end: from + inserted.length - 1,
    };
  }

  const marks = kind === "bold" ? "**" : "_";
  const text = selected || (kind === "bold" ? "bold words" : "italic words");
  const inserted = `${marks}${text}${marks}`;
  return {
    value: value.slice(0, from) + inserted + value.slice(to),
    start: from + marks.length,
    end: from + marks.length + text.length,
  };
}

function FormattingToolbar({
  textareaRef,
  onChange,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
}) {
  function run(kind: FormatKind) {
    const el = textareaRef.current;
    if (!el) return;
    const next = applyFormat(el, kind);
    onChange(next.value);
    // The box is controlled, so the selection has to be put back after React
    // has painted the new text.
    window.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  }

  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      <Button type="button" variant="secondary" size="sm" onClick={() => run("bold")}>
        <Bold />
        Bold
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={() => run("italic")}>
        <Italic />
        Italic
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={() => run("bullets")}>
        <List />
        Bullets
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={() => run("link")}>
        <Link2 />
        Link
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ screen */

export default function Funnels() {
  const [funnels, setFunnels] = useState<Funnel[] | null>(null);
  const [active, setActive] = useState<Funnel | null>(null);
  const [steps, setSteps] = useState<FunnelStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [funnelDraft, setFunnelDraft] = useState<Partial<Funnel> | null>(null);
  const [stepDraft, setStepDraft] = useState<Partial<FunnelStep> | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [reordering, setReordering] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [confirm, confirmDialog] = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  /* Read once, on mount only. `?funnel=` is an opening instruction, not a
     binding: once she clicks a different row the URL follows the selection
     rather than the other way round, so re-reading it here would fight the
     effect below and snap the panel back to the funnel in the address bar. */
  const openAtRef = useRef<number | null>(Number(searchParams.get("funnel")) || null);

  const load = useCallback(async (preferredId?: number) => {
    try {
      const list = await adminApi.growthList<Funnel>("funnels");
        setFunnels(list);
      // Prefer a newly-created funnel explicitly. The former implicit fallback
      // is what left the detail panel showing the previous funnel after Create.
      setActive((prev) => {
        const wantedId = preferredId ?? prev?.id;
        return (wantedId ? list.find((f) => f.id === wantedId) : undefined) ?? list[0] ?? null;
      });
    } catch {
      setError("We couldn't load your funnels. Try refreshing the page.");
    }
  }, []);

  useEffect(() => {
    void load(openAtRef.current ?? undefined);
  }, [load]);

  /* Selection is the single source of truth and the URL trails it, so the view
     is linkable: whichever funnel the panel is showing is the one a copied
     address reopens. `replace` keeps Back going to the previous screen instead
     of walking her through every funnel she happened to click. */
  useEffect(() => {
    if (!active) return;
    if (searchParams.get("funnel") === String(active.id)) return;
    const next = new URLSearchParams(searchParams);
    next.set("funnel", String(active.id));
    setSearchParams(next, { replace: true });
  }, [active, searchParams, setSearchParams]);

  useEffect(() => {
    adminCommerceApi.offerList().then(setOffers).catch(() => setOffers([]));
  }, []);

  const loadSteps = useCallback((id: number) => {
    setSteps(null);
    adminApi.funnelSteps(id).then(setSteps).catch(() => setSteps([]));
  }, []);

  useEffect(() => {
    if (active) loadSteps(active.id);
  }, [active, loadSteps]);

  async function saveFunnel(e: FormEvent) {
    e.preventDefault();
    if (!funnelDraft?.name?.trim()) return;

    // The web address comes from the name rather than a box she has to fill
    // in, and an existing funnel keeps the one it already has so links she has
    // shared carry on working.
    const taken = (funnels ?? []).filter((f) => f.id !== funnelDraft.id).map((f) => f.slug);
    const payload = {
      ...funnelDraft,
      slug: funnelDraft.slug || uniqueKey(slugify(funnelDraft.name) || "funnel", taken, "-"),
    };
    try {
      if (funnelDraft.id) {
        const saved = await adminApi.growthUpdate<Funnel>("funnels", funnelDraft.id, payload);
        toast.success("Saved.");
        setFunnelDraft(null);
        await load(saved.id);
      } else {
        const built = await adminApi.funnelBlueprint(payload);
        toast.success(`Funnel ready with ${built.stageCount} stages and ${built.emailCount} follow-up email${built.emailCount === 1 ? "" : "s"}.`);
        setFunnelDraft(null);
        await load(built.funnel.id);
      }
    } catch (err) {
      toast.error(friendlyError(err, "funnel"));
    }
  }

  async function deleteFunnel(funnel: Funnel) {
    const ok = await confirm({
      title: `Delete the funnel “${funnel.name}”?`,
      description: funnel.formId
        ? "Its blueprint stages, sign-up form, joined tag and follow-up sequence will be deleted too."
        : "Its stages and reporting history will be deleted too.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.growthDelete("funnels", funnel.id);
      setActive(null);
      await load();
      toast.success("Funnel deleted.");
    } catch (err) {
      toast.error(friendlyError(err, "funnel"));
    }
  }

  async function saveStage(e: FormEvent) {
    e.preventDefault();
    if (!stepDraft?.name?.trim() || !active) return;
    const payload = {
      ...stepDraft,
      funnelId: active.id,
      slug: stepDraft.slug || slugify(stepDraft.name) || "stage",
      sort: stepDraft.sort ?? (steps?.length ?? 0),
    };
    try {
      if (stepDraft.id) await adminApi.growthUpdate("steps", stepDraft.id, payload);
      else await adminApi.growthCreate("steps", payload);
      toast.success("Stage saved.");
      setStepDraft(null);
      loadSteps(active.id);
    } catch (err) {
      toast.error(friendlyError(err, "stage"));
    }
  }

  /**
   * Moves a stage one place earlier or later.
   *
   * Stages are a running order, so she needs to be able to change it without
   * ever meeting the number that holds it. Every position is rewritten rather
   * than swapping the two neighbours: saved orders can hold duplicates (a new
   * stage lands on "however many there were"), and a full renumber is the only
   * thing that keeps the list she sees stable.
   */
  async function moveStage(index: number, direction: -1 | 1) {
    if (!steps || !active || reordering) return;
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;

    const reordered = [...steps];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);

    setReordering(true);
    try {
      await Promise.all(
        reordered
          .map((stage, position) => ({ stage, position }))
          .filter(({ stage, position }) => stage.sort !== position)
          .map(({ stage, position }) =>
            adminApi.growthUpdate("steps", stage.id, { sort: position }),
          ),
      );
      loadSteps(active.id);
    } catch (err) {
      toast.error(friendlyError(err, "stage"));
    } finally {
      setReordering(false);
    }
  }

  const totalViews = (steps ?? []).reduce((s, x) => s + x.views, 0);
  const totalConversions = (steps ?? []).reduce((s, x) => s + x.conversions, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Funnels"
        description="Walk people from a first click through to your offer, and see how many make it to each stage."
        actions={
          <Button size="sm" onClick={() => setFunnelDraft({ kind: "opt_in", published: false })}>
            <Plus />
            New funnel
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      {funnels === null ? (
        <Skeleton className="h-64 w-full" />
      ) : funnels.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Split />}
            title="No funnels yet"
            description="Build the path people take — from the page they land on to the thing you're selling."
            action={
              <Button size="sm" onClick={() => setFunnelDraft({ kind: "opt_in", published: false })}>
                Create a funnel
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader title="Your funnels" />
            <ul className="space-y-0.5 p-2">
              {funnels.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setActive(f)}
                    aria-current={active?.id === f.id ? "true" : undefined}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      active?.id === f.id
                        ? "bg-lilac-tint font-semibold text-plum-deep"
                        : "text-ink-soft hover:bg-cream",
                    )}
                  >
                    <Split className="size-4 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {!f.published && (
                      <span className="shrink-0 text-[0.6rem] font-bold uppercase text-ink-soft/60">
                        {PUBLISH_LABEL.draft}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-5">
            {active && (
              <div className="grid gap-5 sm:grid-cols-3">
                <Card className="p-5">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
                    Times viewed
                  </p>
                  <p className="mt-2 font-display text-[1.6rem] leading-none text-ink">
                    {formatNumber(totalViews)}
                  </p>
                </Card>
                <Card className="p-5">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
                    People who went on
                  </p>
                  <p className="mt-2 font-display text-[1.6rem] leading-none text-ink">
                    {formatNumber(totalConversions)}
                  </p>
                </Card>
                <Card className="p-5">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
                    How many went on
                  </p>
                  <p className="mt-2 font-display text-[1.6rem] leading-none text-plum">
                    {totalViews > 0
                      ? `${Math.round((totalConversions / totalViews) * 1000) / 10}%`
                      : "None yet"}
                  </p>
                  <p className="mt-1.5 text-[0.7rem] text-ink-soft">
                    Out of everyone who saw a stage.
                  </p>
                </Card>
              </div>
            )}

            {active && (active.formId || active.sequenceId || active.tagId) && (
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">Blueprint readiness</p>
                    <p className="mt-1 text-sm text-ink-soft">
                      The working parts were created together and are ready for you to personalise.
                    </p>
                  </div>
                  <Badge tone={active.published ? "green" : "neutral"}>
                    {active.published ? "Ready and live" : "Ready to review"}
                  </Badge>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {active.formId && (
                    <a className="flex min-h-11 items-center gap-2 rounded-lg border border-hairline px-3 text-sm font-semibold text-ink hover:border-plum" href={`/admin/marketing/forms-v2?form=${active.formId}`}>
                      <CheckCircle2 className="size-4 text-green" /> Sign-up form and joined tag
                    </a>
                  )}
                  {active.sequenceId && (
                    <a className="flex min-h-11 items-center gap-2 rounded-lg border border-hairline px-3 text-sm font-semibold text-ink hover:border-plum" href={`/admin/marketing/sequences/${active.sequenceId}`}>
                      <CheckCircle2 className="size-4 text-green" /> Follow-up email sequence
                    </a>
                  )}
                  <div className="flex min-h-11 items-center gap-2 rounded-lg border border-hairline px-3 text-sm font-semibold text-ink">
                    <CheckCircle2 className="size-4 text-green" /> {steps?.length ?? 0} connected stages
                  </div>
                  {active.offerId ? (
                    <a className="flex min-h-11 items-center gap-2 rounded-lg border border-hairline px-3 text-sm font-semibold text-ink hover:border-plum" href={`/admin/offers/${active.offerId}`}>
                      <CheckCircle2 className="size-4 text-green" /> Attached offer
                    </a>
                  ) : ["sales", "launch"].includes(active.kind) ? (
                    <div className="flex min-h-11 items-center gap-2 rounded-lg border border-gold/40 bg-gold/5 px-3 text-sm text-ink">
                      Choose an offer before publishing
                    </div>
                  ) : null}
                </div>
              </Card>
            )}

            <Card>
              <CardHeader
                title={active ? `${active.name} — stages` : "Stages"}
                subtitle={
                  active
                    ? active.published
                      ? webAddressLabel("funnel", active.slug)
                      : PUBLISH_LABEL.draft
                    : undefined
                }
                action={
                  <div className="flex gap-2">
                    {active && (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => setFunnelDraft(active)}>
                          Edit this funnel
                        </Button>
                        <Button variant="dangerGhost" size="iconSm" aria-label={`Delete “${active.name}”`} onClick={() => deleteFunnel(active)}>
                          <Trash2 />
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      disabled={!active}
                      onClick={() => setStepDraft({ stepType: "landing", ctaLabel: "Continue" })}
                    >
                      <Plus />
                      Add a stage
                    </Button>
                  </div>
                }
              />

              {steps === null ? (
                <div className="space-y-2 p-5">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : steps.length === 0 ? (
                <EmptyState
                  icon={<Split />}
                  title="No stages yet"
                  description="Start with a landing page — the first thing people see when they arrive."
                />
              ) : (
                <div className="space-y-0 p-5">
                  {steps.map((step, i) => {
                    const rate =
                      step.views > 0
                        ? Math.round((step.conversions / step.views) * 1000) / 10
                        : null;
                    return (
                      <div key={step.id}>
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(i * 0.05, 0.3) }}
                          className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-surface p-4 transition-colors hover:border-plum/35"
                        >
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-lilac-tint text-sm font-bold text-plum-deep">
                            {i + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => setStepDraft(step)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block truncate font-semibold text-ink">
                              {step.name}
                            </span>
                            <span className="block truncate text-xs text-ink-soft">
                              {step.headline || stageTypeHint(step.stepType)}
                            </span>
                          </button>
                          <Badge tone="plum">{stageTypeLabel(step.stepType)}</Badge>
                          <div className="text-right">
                            <p className="text-xs text-ink-soft">
                              {formatNumber(step.views)} saw this ·{" "}
                              {formatNumber(step.conversions)} went on
                            </p>
                            {rate !== null && (
                              <p className="flex items-center justify-end gap-1 text-sm font-bold text-green">
                                <TrendingUp className="size-3.5" />
                                {rate}%
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col">
                            <Button
                              variant="ghost"
                              size="iconSm"
                              className="h-6"
                              aria-label={`Move “${step.name}” earlier`}
                              disabled={i === 0 || reordering}
                              onClick={() => moveStage(i, -1)}
                            >
                              <ChevronUp />
                            </Button>
                            <Button
                              variant="ghost"
                              size="iconSm"
                              className="h-6"
                              aria-label={`Move “${step.name}” later`}
                              disabled={i === steps.length - 1 || reordering}
                              onClick={() => moveStage(i, 1)}
                            >
                              <ChevronDown />
                            </Button>
                          </div>
                          <Button
                            variant="dangerGhost"
                            size="iconSm"
                            aria-label={`Delete “${step.name}”`}
                            onClick={async () => {
                              const ok = await confirm({
                                title: `Delete the stage “${step.name}”?`,
                                description: "The rest of the funnel stays as it is.",
                                confirmLabel: "Yes, delete it",
                                destructive: true,
                              });
                              if (!ok || !active) return;
                              try {
                                await adminApi.growthDelete("steps", step.id);
                                loadSteps(active.id);
                              } catch (err) {
                                toast.error(friendlyError(err, "stage"));
                              }
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </motion.div>
                        {i < steps.length - 1 && (
                          <div className="flex justify-center py-1.5">
                            <ArrowDown className="size-4 text-ink-soft/40" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {active && (
                <div className="border-t border-hairline/60 p-4">
                  {/* The link she can send to a person is the only thing worth
                      showing here. A funnel that isn't live has no page yet, so
                      it says so rather than offering a dead link. */}
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                    Share this funnel
                  </p>
                  {active.published ? (
                    <>
                      <div className="mt-2 flex items-center gap-2 rounded-xl border border-hairline bg-cream/60 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                          {shareLink("funnel", active.slug)}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label="Copy the link to this funnel"
                          onClick={() =>
                            navigator.clipboard
                              .writeText(shareLink("funnel", active.slug))
                              .then(() => toast.success("Link copied."))
                              .catch(() =>
                                toast.error("We couldn't copy that. Try selecting it by hand."),
                              )
                          }
                        >
                          <Copy />
                        </Button>
                        <Button variant="secondary" size="sm" asChild>
                          <a href={`/funnel/${active.slug}`} target="_blank" rel="noreferrer">
                            <ExternalLink />
                            Open
                          </a>
                        </Button>
                      </div>
                      <p className="mt-1.5 text-xs text-ink-soft">
                        Send this to anyone — it drops them at the first stage.
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 rounded-xl border border-hairline bg-cream/60 px-3 py-2.5 text-xs text-ink-soft">
                      This funnel isn't live yet. Open “Edit this funnel”, turn on “Live on my
                      site”, and you'll get a link you can share.
                    </p>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      <Modal
        open={funnelDraft !== null}
        onOpenChange={(open) => !open && setFunnelDraft(null)}
        title={funnelDraft?.id ? "Edit this funnel" : "Create a funnel"}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setFunnelDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="funnel-form">
              Save
            </Button>
          </>
        }
      >
        {funnelDraft && (
          <form id="funnel-form" onSubmit={saveFunnel} className="space-y-4">
            <Field label="Name this funnel" hint="just so you can find it">
              <Input
                value={funnelDraft.name ?? ""}
                onChange={(e) => setFunnelDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Free masterclass"
                required
                autoFocus
              />
            </Field>
            <Field label="What's it for?" hint="a note to yourself">
              <Textarea
                rows={2}
                value={funnelDraft.description ?? ""}
                onChange={(e) => setFunnelDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </Field>
            <Field label="What is this journey for?">
              <select
                value={funnelDraft.kind ?? "opt_in"}
                onChange={(e) => setFunnelDraft((d) => ({ ...d, kind: e.target.value }))}
                className={selectStyles}
              >
                {FUNNEL_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </Field>
            {!funnelDraft.id && (
              <div className="rounded-xl border border-plum/20 bg-lilac-tint/45 p-3 text-sm text-ink">
                <strong>This blueprint creates:</strong>{" "}
                {BLUEPRINT_SUMMARY[funnelDraft.kind ?? "opt_in"]}.
              </div>
            )}
            {!funnelDraft.id && ["sales", "launch"].includes(funnelDraft.kind ?? "") && offers.length > 0 && (
              <Field label="Offer this funnel sells" hint="optional — you can connect it later">
                <select
                  className={selectStyles}
                  value={funnelDraft.offerId ?? ""}
                  onChange={(event) => setFunnelDraft((current) => ({
                    ...current,
                    offerId: event.target.value ? Number(event.target.value) : null,
                  }))}
                >
                  <option value="">Choose later</option>
                  {offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.title}</option>)}
                </select>
              </Field>
            )}
            <div>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={Boolean(funnelDraft.published)}
                  onChange={(e) => setFunnelDraft((d) => ({ ...d, published: e.target.checked }))}
                  className="size-4 rounded border-hairline text-plum"
                />
                Live on my site
              </label>
              <p className="mt-1.5 text-xs text-ink-soft">
                {funnelDraft.published
                  ? "You'll get a link you can share with anyone."
                  : "Not visible yet — nobody can open it until you tick this."}
              </p>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={stepDraft !== null}
        onOpenChange={(open) => !open && setStepDraft(null)}
        title={stepDraft?.id ? "Edit this stage" : "Add a stage"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setStepDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="step-form">
              Save stage
            </Button>
          </>
        }
      >
        {stepDraft && (
          <form id="step-form" onSubmit={saveStage} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name this stage" hint="just so you can find it">
              <Input
                value={stepDraft.name ?? ""}
                onChange={(e) => setStepDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Sign-up page"
                required
                autoFocus
              />
            </Field>
            <Field
              label="What is this stage for?"
              hint={stageTypeHint(stepDraft.stepType ?? "landing")}
            >
              <select
                value={stepDraft.stepType ?? "landing"}
                onChange={(e) => setStepDraft((d) => ({ ...d, stepType: e.target.value }))}
                className={selectStyles}
              >
                {STAGE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Headline" hint="the big line at the top" className="sm:col-span-2">
              <Input
                value={stepDraft.headline ?? ""}
                onChange={(e) => setStepDraft((d) => ({ ...d, headline: e.target.value }))}
              />
            </Field>
            <Field label="Body" className="sm:col-span-2">
              <FormattingToolbar
                textareaRef={bodyRef}
                onChange={(value) => setStepDraft((d) => ({ ...d, bodyMd: value }))}
              />
              <Textarea
                ref={bodyRef}
                rows={6}
                value={stepDraft.bodyMd ?? ""}
                onChange={(e) => setStepDraft((d) => ({ ...d, bodyMd: e.target.value }))}
                placeholder="What you want people to read on this page…"
              />
            </Field>
            <Field label="Button text">
              <Input
                value={stepDraft.ctaLabel ?? ""}
                onChange={(e) => setStepDraft((d) => ({ ...d, ctaLabel: e.target.value }))}
                placeholder="Book a call"
              />
            </Field>
            <Field label="Button goes to" hint="a page on your site, or a full web address">
              <Input
                value={stepDraft.ctaUrl ?? ""}
                onChange={(e) => setStepDraft((d) => ({ ...d, ctaUrl: e.target.value }))}
                placeholder="/apply"
              />
            </Field>
          </form>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
