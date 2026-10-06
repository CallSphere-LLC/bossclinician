import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useSearchParams } from "react-router";
import { motion } from "motion/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowDown,
  ArrowLeft,
  BarChart3,
  Bold,
  CheckCircle2,
  ChevronDown,
  Circle,
  ChevronUp,
  Copy,
  ExternalLink,
  Italic,
  Link2,
  List,
  MoreHorizontal,
  Pencil,
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
import { publicSiteUrl } from "@/lib/siteOrigins";
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
import { friendlyError, shareLink, slugify, uniqueKey } from "@/pages/admin/ui/friendly";

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

/** The state of a blueprint's working parts — `GET /admin/growth/funnels/:id`. */
interface FunnelReadiness {
  sequenceStatus: string | null;
  sequenceEmailCount: number;
  formPublished: boolean | null;
}

/** One line of the readiness card. `done` is undefined while it is unknown. */
interface ReadinessItem {
  key: string;
  done: boolean | undefined;
  label: string;
  href?: string;
}

const READINESS_ROW =
  "flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold text-ink";

function ReadinessRow({ item }: { item: ReadinessItem }) {
  const className = cn(
    READINESS_ROW,
    item.done === false ? "border-gold/40 bg-gold/5" : "border-hairline",
    item.href && "hover:border-plum",
  );
  const content = (
    <>
      {item.done ? (
        <CheckCircle2 className="size-4 shrink-0 text-green" aria-hidden />
      ) : (
        <Circle
          className={cn("size-4 shrink-0", item.done === false ? "text-gold" : "text-ink-soft")}
          aria-hidden
        />
      )}
      <span>
        <span className="sr-only">{item.done ? "Done: " : item.done === false ? "To do: " : ""}</span>
        {item.label}
      </span>
    </>
  );
  return item.href ? (
    <a className={className} href={item.href}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

/**
 * What a blueprint funnel still needs before it works end to end.
 *
 * Every line used to be a green tick for a part that merely existed — a funnel
 * whose follow-up was an unsent draft read "Ready and live". Each tick is now a
 * fact the server reported. A draft sequence on an unpublished funnel is not a
 * line of its own: publishing is what switches it on, so that is the step.
 */
function readinessItems(
  funnel: Funnel,
  stageCount: number | null,
  parts: FunnelReadiness | null | undefined,
): ReadinessItem[] {
  const items: ReadinessItem[] = [];

  if (funnel.formId) {
    const done = parts ? parts.formPublished === true : undefined;
    items.push({
      key: "form",
      done,
      label: done === false ? "Publish the sign-up form" : "Sign-up form and joined tag",
      href: `/admin/marketing/forms-v2?form=${funnel.formId}`,
    });
  }

  if (funnel.sequenceId) {
    const href = `/admin/marketing/sequences/${funnel.sequenceId}`;
    if (!parts) {
      items.push({ key: "sequence", done: undefined, label: "Follow-up email sequence", href });
    } else if (parts.sequenceEmailCount === 0) {
      items.push({ key: "sequence", done: false, label: "Add an email to the follow-up sequence", href });
    } else {
      const emails = `${parts.sequenceEmailCount} email${parts.sequenceEmailCount === 1 ? "" : "s"}`;
      const status = parts.sequenceStatus;
      items.push(
        status === "active"
          ? { key: "sequence", done: true, label: `Follow-up sequence switched on, ${emails}`, href }
          : status === "draft" && !funnel.published
            ? { key: "sequence", done: true, label: `Follow-up sequence written, ${emails} — switches on when you publish`, href }
            : { key: "sequence", done: false, label: `Switch on the follow-up sequence — it is ${status === "draft" ? "still a draft" : (status ?? "off")}`, href },
      );
    }
  }

  items.push({
    key: "stages",
    done: stageCount === null ? undefined : stageCount > 0,
    label:
      stageCount === 0
        ? "Add a first stage"
        : `${stageCount ?? 0} connected stage${stageCount === 1 ? "" : "s"}`,
  });

  if (funnel.offerId) {
    items.push({ key: "offer", done: true, label: "Attached offer", href: `/admin/offers/${funnel.offerId}` });
  } else if (["sales", "launch"].includes(funnel.kind)) {
    items.push({ key: "offer", done: false, label: "Choose an offer before publishing" });
  }

  items.push({
    key: "published",
    done: funnel.published,
    label: funnel.published ? "Published" : "Publish the funnel",
  });

  return items;
}

/** The readiness card: real ticks, and a count of what is left. */
function BlueprintReadiness({
  funnel,
  stageCount,
  readiness,
}: {
  funnel: Funnel;
  stageCount: number | null;
  /** `undefined` while the check is in flight, `null` once it has failed. */
  readiness: FunnelReadiness | null | undefined;
}) {
  const items = readinessItems(funnel, stageCount, readiness);
  const failed = readiness === null;
  const checking = !failed && (readiness === undefined || stageCount === null);
  const left = items.filter((item) => item.done === false).length;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">Blueprint readiness</p>
          <p className="mt-1 text-sm text-ink-soft">
            {failed
              ? "We couldn't check the sign-up form and follow-up emails just now. Try refreshing the page."
              : checking
                ? "Checking the working parts of this funnel."
                : left === 0
                  ? "Every working part is in place and switched on."
                  : "What is still to do before this funnel works from start to finish."}
          </p>
        </div>
        <Badge tone={failed || checking ? "neutral" : left === 0 ? "green" : "gold"}>
          {failed
            ? "Not checked"
            : checking
              ? "Checking"
              : left === 0
                ? "Ready and live"
                : `${left} step${left === 1 ? "" : "s"} left`}
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <ReadinessRow key={item.key} item={item} />
        ))}
      </div>
    </Card>
  );
}

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

/* ------------------------------------------------------- Kajabi-style list */

/**
 * A funnel as the list sends it: the row, its step counts, and — for one
 * brought over from Kajabi — Kajabi's own status and visitor count.
 */
type FunnelRow = Funnel & {
  stepCount?: number;
  stepViews?: number;
  stepConversions?: number;
  source?: string | null;
  kajabiId?: string | number | null;
  kajabiStatus?: string | null;
  kajabiVisitors?: number | string | null;
  createdAt?: string;
  updatedAt?: string;
};

function isKajabiFunnel(funnel: FunnelRow): boolean {
  return funnel.source === "kajabi";
}

/** Kajabi calls a finished funnel "Ready"; anything else reads from `published`. */
function funnelStatus(funnel: FunnelRow): { label: string; tone: "green" | "slate" } {
  if (funnel.kajabiStatus === "finished") return { label: "Ready", tone: "green" };
  return funnel.published ? { label: "Published", tone: "green" } : { label: "Draft", tone: "slate" };
}

/** Kajabi's visitor count when it sent one; otherwise every view of every step. */
function funnelVisitors(funnel: FunnelRow, steps?: FunnelStep[] | null): number {
  const kajabi = funnel.kajabiVisitors;
  if (kajabi !== null && kajabi !== undefined && kajabi !== "" && Number.isFinite(Number(kajabi))) {
    return Number(kajabi);
  }
  if (steps) return steps.reduce((sum, step) => sum + step.views, 0);
  return funnel.stepViews ?? 0;
}

/**
 * Where a step's page lives on the public site.
 *
 * A Kajabi funnel's pages kept their Kajabi addresses (the sales page is
 * /profitable-private-practice-leap-accelerator), carried on the step as its
 * path; a funnel built here serves every step from /funnel/<slug>/<step>, the
 * same address `FunnelPage` builds.
 */
function stepPagePath(funnel: FunnelRow, step: FunnelStep, index: number): string {
  if (isKajabiFunnel(funnel)) {
    const own = (step.ctaUrl ?? "").trim();
    if (own.startsWith("/") && own.length > 1 && !own.startsWith("/funnel/")) return own;
    if (step.slug) return `/${step.slug.replace(/^\/+/, "")}`;
  }
  return `/funnel/${funnel.slug}/${step.slug || index + 1}`;
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    date,
  );
}

/** Kajabi's default sort: the funnel touched most recently first. */
function byRecentlyUpdated(a: FunnelRow, b: FunnelRow): number {
  const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  return bt - at || b.id - a.id;
}

function MenuItem({
  icon,
  children,
  onSelect,
  destructive,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none [&_svg]:size-4",
        destructive
          ? "text-red-400 data-[highlighted]:bg-red-500/10"
          : "text-ink data-[highlighted]:bg-white/[0.07] [&_svg]:text-ink-soft",
      )}
    >
      {icon}
      {children}
    </DropdownMenu.Item>
  );
}

/** The card's Options menu: the actions the screen already had, in one place. */
function FunnelOptions({
  funnel,
  onOpen,
  onEdit,
  onStats,
  onCopyLink,
  onDelete,
}: {
  funnel: FunnelRow;
  onOpen?: () => void;
  onEdit: () => void;
  onStats: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="iconSm" aria-label={`Options for “${funnel.name}”`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[13rem] rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-[0_24px_54px_-18px_rgba(0,0,0,0.85)]"
        >
          {onOpen && (
            <MenuItem icon={<Split />} onSelect={onOpen}>
              Open
            </MenuItem>
          )}
          <MenuItem icon={<Pencil />} onSelect={onEdit}>
            Edit details
          </MenuItem>
          <MenuItem icon={<BarChart3 />} onSelect={onStats}>
            View stats
          </MenuItem>
          <MenuItem icon={<Link2 />} onSelect={onCopyLink}>
            Copy link
          </MenuItem>
          <DropdownMenu.Separator className="my-1 h-px bg-hairline" />
          <MenuItem icon={<Trash2 />} onSelect={onDelete} destructive>
            Delete
          </MenuItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Kajabi's Funnel Checklist, for a funnel that isn't one of the blueprints
 * (those have their own readiness card, which checks the form and emails).
 * Every line is a fact about the saved funnel; "N Steps Left" counts the
 * ones still open.
 */
function FunnelChecklist({ funnel, steps }: { funnel: FunnelRow; steps: FunnelStep[] | null }) {
  const items: ReadinessItem[] = [
    {
      key: "pages",
      done: steps === null ? undefined : steps.length > 0,
      label:
        steps === null
          ? "Pages"
          : steps.length === 0
            ? "Add a first page"
            : `${steps.length} ${steps.length === 1 ? "page" : "pages"} in this funnel`,
    },
  ];
  if (funnel.offerId) {
    items.push({ key: "offer", done: true, label: "Offer attached", href: `/admin/offers/${funnel.offerId}` });
  } else if (!isKajabiFunnel(funnel) && ["sales", "launch"].includes(funnel.kind)) {
    items.push({ key: "offer", done: false, label: "Choose an offer before publishing" });
  }
  const ready = funnel.published || funnel.kajabiStatus === "finished";
  items.push({
    key: "status",
    done: ready,
    label: funnel.published ? "Published" : ready ? "Ready — finished in Kajabi" : "Publish the funnel",
  });

  const left = items.filter((item) => item.done === false).length;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">Funnel Checklist</p>
          <p className="mt-1 text-sm text-ink-soft">
            {left === 0
              ? "Everything this funnel needs is in place."
              : "What is still to do before this funnel works from start to finish."}
          </p>
        </div>
        <Badge tone={left === 0 ? "green" : "gold"}>
          {left} {left === 1 ? "Step" : "Steps"} Left
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <ReadinessRow key={item.key} item={item} />
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ screen */

export default function Funnels() {
  const [funnels, setFunnels] = useState<FunnelRow[] | null>(null);
  const [active, setActive] = useState<FunnelRow | null>(null);
  const [steps, setSteps] = useState<FunnelStep[] | null>(null);
  // `undefined` while the check is in flight, `null` once it has failed.
  const [readiness, setReadiness] = useState<FunnelReadiness | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [funnelDraft, setFunnelDraft] = useState<Partial<Funnel> | null>(null);
  const [stepDraft, setStepDraft] = useState<Partial<FunnelStep> | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [reordering, setReordering] = useState(false);
  const [savingFunnel, setSavingFunnel] = useState(false);
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
      const list = await adminApi.growthList<FunnelRow>("funnels");
      setFunnels(list);
      // Prefer a newly-created funnel explicitly. With nothing asked for, the
      // list of cards shows, as Kajabi's does, rather than the first funnel.
      setActive((prev) => {
        const wantedId = preferredId ?? prev?.id;
        return (wantedId ? list.find((f) => f.id === wantedId) : undefined) ?? null;
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
    if (!active) {
      // Back on the list: the address stops naming a funnel. Not before the
      // first load lands, or the link that opened the page would be dropped.
      if (funnels === null || !searchParams.has("funnel")) return;
      const next = new URLSearchParams(searchParams);
      next.delete("funnel");
      setSearchParams(next, { replace: true });
      return;
    }
    if (searchParams.get("funnel") === String(active.id)) return;
    const next = new URLSearchParams(searchParams);
    next.set("funnel", String(active.id));
    setSearchParams(next, { replace: true });
  }, [active, funnels, searchParams, setSearchParams]);

  useEffect(() => {
    adminCommerceApi.offerList().then(setOffers).catch(() => setOffers([]));
  }, []);

  /* Only the latest request may land. Clicking one funnel and then another
     before the first answered could otherwise paint the first funnel's stages
     under the second's name — and a reorder or delete then acted on them. */
  const stepsRequestRef = useRef(0);
  /* A reload that finishes a reorder or save of a funnel she has since left
     must not be issued: as the latest request it would win over the one for
     the funnel now on screen. */
  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = active?.id ?? null;
  const loadSteps = useCallback((id: number) => {
    if (id !== activeIdRef.current) return;
    const request = ++stepsRequestRef.current;
    setSteps(null);
    adminApi
      .funnelSteps(id)
      .then((list) => {
        if (request === stepsRequestRef.current) setSteps(list);
      })
      .catch(() => {
        if (request === stepsRequestRef.current) setSteps([]);
      });
  }, []);

  useEffect(() => {
    if (active) loadSteps(active.id);
  }, [active, loadSteps]);

  /* Re-read whenever the selection is replaced, which a save does too — so
     publishing a funnel is followed by the card showing what publishing did. */
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setReadiness(undefined);
    adminApi
      .growthGet<Funnel & { readiness?: FunnelReadiness }>("funnels", active.id)
      .then((detail) => {
        if (!cancelled) setReadiness(detail.readiness ?? null);
      })
      .catch(() => {
        if (!cancelled) setReadiness(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  async function saveFunnel(e: FormEvent) {
    e.preventDefault();
    if (!funnelDraft?.name?.trim() || savingFunnel) return;

    // The web address comes from the name rather than a box she has to fill
    // in, and an existing funnel keeps the one it already has so links she has
    // shared carry on working.
    const taken = (funnels ?? []).filter((f) => f.id !== funnelDraft.id).map((f) => f.slug);
    const payload = {
      ...funnelDraft,
      slug: funnelDraft.slug || uniqueKey(slugify(funnelDraft.name) || "funnel", taken, "-"),
      // The offer picker only shows for a sales or launch funnel, but an offer
      // chosen there survived switching the kind back, and an opt-in funnel was
      // built with an offer attached that nothing on screen had shown.
      ...(!funnelDraft.id && !["sales", "launch"].includes(funnelDraft.kind ?? "")
        ? { offerId: null }
        : {}),
    };
    // A second click on Create while the first was building ran the blueprint
    // twice, and the second failed on the web address the first had just taken.
    setSavingFunnel(true);
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
    } finally {
      setSavingFunnel(false);
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
    } catch (err) {
      toast.error(friendlyError(err, "stage"));
    } finally {
      setReordering(false);
      // Also after a failure: some of the renumbering writes may have landed,
      // and the next move is computed from the positions shown here.
      loadSteps(active.id);
    }
  }

  const totalViews = (steps ?? []).reduce((s, x) => s + x.views, 0);
  const totalConversions = (steps ?? []).reduce((s, x) => s + x.conversions, 0);
  const activeOffer = active?.offerId ? offers.find((offer) => offer.id === active.offerId) : undefined;

  /**
   * The link to send someone: the funnel's first page. A funnel brought over
   * from Kajabi lives on its own page paths, so its first page is read from its
   * steps; one built here opens at /funnel/<slug>.
   */
  async function copyFunnelLink(funnel: FunnelRow, knownSteps?: FunnelStep[] | null) {
    try {
      let url: string | null = null;
      if (isKajabiFunnel(funnel)) {
        const list = knownSteps ?? (await adminApi.funnelSteps(funnel.id));
        const first = list[0];
        url = first ? publicSiteUrl(stepPagePath(funnel, first, 0)) : null;
      } else if (funnel.published) {
        url = shareLink("funnel", funnel.slug);
      }
      if (!url) {
        toast.error("This funnel isn't live yet, so there is no link to share.");
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      toast.error("We couldn't copy that. Try selecting it by hand.");
    }
  }

  function openFunnel(funnel: FunnelRow, section?: "stats") {
    setActive(funnel);
    if (section === "stats") {
      window.requestAnimationFrame(() =>
        document.getElementById("funnel-stats")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }

  const sortedFunnels = funnels ? [...funnels].sort(byRecentlyUpdated) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Funnels"
        description="Walk people from a first click through to your offer, and see how many make it to each step."
        actions={
          <Button size="sm" onClick={() => setFunnelDraft({ kind: "opt_in", published: false })}>
            <Plus />
            New funnel
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      {sortedFunnels === null ? (
        <Skeleton className="h-64 w-full" />
      ) : sortedFunnels.length === 0 ? (
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
      ) : !active ? (
        /* ------------------------------------------------------ the list */
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
            <span className="font-semibold">Sort: Recently updated</span>
            <span>
              Showing 1-{sortedFunnels.length} of {sortedFunnels.length}{" "}
              {sortedFunnels.length === 1 ? "result" : "results"}
            </span>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sortedFunnels.map((f) => {
              const status = funnelStatus(f);
              const stepCount = f.stepCount;
              return (
                <li key={f.id}>
                  <Card className="flex h-full flex-col gap-3 p-4 transition-colors hover:border-plum/35">
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-lilac-tint text-plum">
                        <Split className="size-4" />
                      </span>
                      <button
                        type="button"
                        onClick={() => openFunnel(f)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate font-semibold text-ink hover:text-plum">
                          {f.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-soft">
                          {f.updatedAt ? `Updated ${formatDay(f.updatedAt)}` : " "}
                        </span>
                      </button>
                      <FunnelOptions
                        funnel={f}
                        onOpen={() => openFunnel(f)}
                        onEdit={() => setFunnelDraft(f)}
                        onStats={() => openFunnel(f, "stats")}
                        onCopyLink={() => void copyFunnelLink(f)}
                        onDelete={() => void deleteFunnel(f)}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {isKajabiFunnel(f) && <Badge tone="plum">Imported from Kajabi</Badge>}
                    </div>
                    <p className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
                      <span>
                        <span className="font-bold tabular-nums text-ink">
                          {stepCount === undefined ? "–" : formatNumber(stepCount)}
                        </span>{" "}
                        {stepCount === 1 ? "step" : "steps"}
                      </span>
                      <span>
                        <span className="font-bold tabular-nums text-ink">
                          {formatNumber(funnelVisitors(f))}
                        </span>{" "}
                        {funnelVisitors(f) === 1 ? "visitor" : "visitors"}
                      </span>
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        /* ---------------------------------------------------- one funnel */
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Button variant="ghost" size="sm" onClick={() => setActive(null)}>
                <ArrowLeft />
                All funnels
              </Button>
              <h2 className="mt-2 truncate font-display text-xl text-ink">{active.name}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={funnelStatus(active).tone}>{funnelStatus(active).label}</Badge>
                {isKajabiFunnel(active) && <Badge tone="plum">Imported from Kajabi</Badge>}
                {active.createdAt && (
                  <span className="text-xs text-ink-soft">Created {formatDay(active.createdAt)}</span>
                )}
                {active.updatedAt && (
                  <span className="text-xs text-ink-soft">· Updated {formatDay(active.updatedAt)}</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => void copyFunnelLink(active, steps)}>
                <Copy />
                Copy Link
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setFunnelDraft(active)}>
                Edit this funnel
              </Button>
              <FunnelOptions
                funnel={active}
                onEdit={() => setFunnelDraft(active)}
                onStats={() => openFunnel(active, "stats")}
                onCopyLink={() => void copyFunnelLink(active, steps)}
                onDelete={() => void deleteFunnel(active)}
              />
            </div>
          </div>

          {active.formId || active.sequenceId || active.tagId ? (
            <BlueprintReadiness
              funnel={active}
              stageCount={steps ? steps.length : null}
              readiness={readiness}
            />
          ) : (
            <FunnelChecklist funnel={active} steps={steps} />
          )}

          <div id="funnel-stats" className="grid scroll-mt-6 grid-cols-1 gap-5 sm:grid-cols-3">
            <Card className="p-5">
              <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
                Visitors
              </p>
              <p className="mt-2 font-bold tabular-nums text-[1.6rem] leading-none text-ink">
                {formatNumber(funnelVisitors(active, steps))}
              </p>
              {isKajabiFunnel(active) && active.kajabiVisitors != null && (
                <p className="mt-1.5 text-[0.7rem] text-ink-soft">As counted by Kajabi.</p>
              )}
            </Card>
            <Card className="p-5">
              <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
                People who went on
              </p>
              <p className="mt-2 font-bold tabular-nums text-[1.6rem] leading-none text-ink">
                {formatNumber(totalConversions)}
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
                How many went on
              </p>
              <p className="mt-2 font-bold tabular-nums text-[1.6rem] leading-none text-plum">
                {totalViews > 0
                  ? `${Math.round((totalConversions / totalViews) * 1000) / 10}%`
                  : "None yet"}
              </p>
              <p className="mt-1.5 text-[0.7rem] text-ink-soft">
                Out of everyone who saw a page.
              </p>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Pages"
              subtitle={
                steps === null
                  ? undefined
                  : `${steps.length} ${steps.length === 1 ? "page" : "pages"}, in the order people see them`
              }
              action={
                <Button
                  size="sm"
                  onClick={() => setStepDraft({ stepType: "landing", ctaLabel: "Continue" })}
                >
                  <Plus />
                  Add a page
                </Button>
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
                title="No pages yet"
                description="Start with a landing page — the first thing people see when they arrive."
              />
            ) : (
              <div className="space-y-0 p-5">
                {steps.map((step, i) => {
                  const rate =
                    step.views > 0
                      ? Math.round((step.conversions / step.views) * 1000) / 10
                      : null;
                  const path = stepPagePath(active, step, i);
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
                          <span className="block truncate text-xs text-ink-soft">{path}</span>
                        </button>
                        <Badge tone="plum">{stageTypeLabel(step.stepType)}</Badge>
                        <div className="text-right">
                          <p className="text-xs text-ink-soft">
                            <span className="font-bold tabular-nums text-ink">
                              {formatNumber(step.views)}
                            </span>{" "}
                            views ·{" "}
                            <span className="font-bold tabular-nums text-ink">
                              {formatNumber(step.conversions)}
                            </span>{" "}
                            went on
                          </p>
                          {rate !== null && (
                            <p className="flex items-center justify-end gap-1 text-sm font-bold tabular-nums text-green">
                              <TrendingUp className="size-3.5" />
                              {rate}%
                            </p>
                          )}
                        </div>
                        <Button variant="secondary" size="sm" asChild>
                          <a
                            href={publicSiteUrl(path)}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`View the page “${step.name}”`}
                          >
                            <ExternalLink />
                            View page
                          </a>
                        </Button>
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
                              title: `Delete the page “${step.name}”?`,
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
          </Card>

          <Card className="p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Offer</p>
            {active.offerId ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">
                  {activeOffer?.title ?? "The attached offer"}
                </p>
                <Button variant="secondary" size="sm" asChild>
                  <a href={`/admin/offers/${active.offerId}`}>Open the offer</a>
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">No offer — this funnel doesn't sell anything directly.</p>
            )}
          </Card>

          <Card className="p-4">
            {/* The link she can send to a person is the only thing worth
                showing here. A funnel that isn't live has no page yet, so it
                says so rather than offering a dead link. */}
            <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">
              Share this funnel
            </p>
            {isKajabiFunnel(active) && steps && steps[0] ? (
              <>
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-hairline bg-cream/60 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                    {publicSiteUrl(stepPagePath(active, steps[0], 0))}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="Copy the link to this funnel"
                    onClick={() => void copyFunnelLink(active, steps)}
                  >
                    <Copy />
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-ink-soft">
                  The funnel's first page, at the same address it had on Kajabi.
                </p>
              </>
            ) : active.published ? (
              <>
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-hairline bg-cream/60 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                    {shareLink("funnel", active.slug)}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="Copy the link to this funnel"
                    onClick={() => void copyFunnelLink(active, steps)}
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
                  Send this to anyone — it drops them at the first page.
                </p>
              </>
            ) : (
              <p className="mt-2 rounded-xl border border-hairline bg-cream/60 px-3 py-2.5 text-xs text-ink-soft">
                This funnel isn't live yet. Open “Edit this funnel”, turn on “Live on my site”, and
                you'll get a link you can share.
              </p>
            )}
          </Card>
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
            <Button size="sm" type="submit" form="funnel-form" disabled={savingFunnel}>
              {savingFunnel ? "Saving…" : "Save"}
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
          <form id="step-form" onSubmit={saveStage} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
