import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import {
  ArrowDown,
  CheckCircle2,
  CirclePlay,
  Pause,
  Play,
  Plus,
  Trash2,
  Workflow,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type {
  AdminForm,
  Automation,
  AutomationAction,
  AutomationRun,
  Community,
} from "@/types/admin";
import type { Course as PublicCourse } from "@/types";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
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
  type BadgeProps,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, humanizeKey, pluralize } from "@/pages/admin/ui/friendly";

/**
 * Everything on this screen is a translation of one of three stored strings —
 * the trigger, the action and the run status. The stored `value` is what the
 * engine matches on and must never change; the label beside it is the only
 * thing the owner ever reads. Keeping the pairs in one table each means a
 * wording change lands on the picker, the summary card and the history at once.
 */
interface TriggerDef {
  value: string;
  label: string;
  hint: string;
}

const TRIGGERS: TriggerDef[] = [
  {
    value: "lead_created",
    label: "Someone sends you a new enquiry",
    hint: "they fill in your contact form, your application form, or any form you've built",
  },
  {
    value: "subscriber_created",
    label: "Someone joins your email list",
    hint: "they sign up from your site or for a free download",
  },
  {
    value: "order_paid",
    label: "Someone pays for a course",
    hint: "their payment goes through",
  },
  {
    value: "member_created",
    label: "Someone becomes a member",
    hint: "you add them, or they buy something",
  },
  {
    value: "community_joined",
    label: "Someone joins one of your communities",
    hint: "",
  },
  {
    value: "challenge_approved",
    label: "You approve a challenge entry",
    hint: "",
  },
];

function triggerLabel(value: string): string {
  return TRIGGERS.find((t) => t.value === value)?.label ?? humanizeKey(value);
}

interface ActionDef {
  value: string;
  label: string;
  /** Which extra questions this one needs answering. */
  needs: string[];
}

const ACTIONS: ActionDef[] = [
  { value: "send_email", label: "Email the person", needs: ["subject", "body"] },
  { value: "notify_admin", label: "Email me about it", needs: ["subject", "body"] },
  { value: "create_member", label: "Give them access as a member", needs: [] },
  { value: "add_subscriber", label: "Add them to my email list", needs: ["source"] },
  { value: "enroll_course", label: "Put them in a course", needs: ["courseId"] },
  { value: "join_community", label: "Add them to a community", needs: ["communityId"] },
  { value: "award_points", label: "Give them community points", needs: ["communityId", "points"] },
];

function actionLabel(value: string): string {
  return ACTIONS.find((a) => a.value === value)?.label ?? humanizeKey(value);
}

const RUN_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  success: "green",
  partial: "gold",
  failed: "red",
  skipped: "slate",
};

/** How a finished run reads on the Activity list. */
const RUN_LABEL: Record<string, string> = {
  success: "Everything ran",
  partial: "Some of it ran",
  failed: "Didn't run",
  skipped: "Skipped",
};

/* ------------------------------------------------------------- conditions */

/**
 * The facts the engine can check before it runs. `key` is the name the stored
 * condition uses; the label is what she picks from.
 */
const CONDITION_FIELDS: { key: string; label: string }[] = [
  { key: "source", label: "Where they came from" },
  { key: "name", label: "Their name" },
  { key: "email", label: "Their email address" },
  { key: "courseTitle", label: "The course they bought" },
];

/** Which of those are worth offering for each thing that can happen. */
const TRIGGER_CONDITION_KEYS: Record<string, string[]> = {
  lead_created: ["source", "email", "name"],
  subscriber_created: ["source", "email"],
  order_paid: ["courseTitle", "email"],
  member_created: ["email", "name"],
  community_joined: ["email"],
  challenge_approved: ["email"],
};

/**
 * The places a person can arrive from, in her words. The stored values are the
 * short tags the public pages send with each capture; she reads the page.
 */
const ARRIVAL_POINTS: Record<string, string> = {
  contact: "your contact form",
  apply: "your application form",
  "work-with-me": "your “work with me” page",
  resources: "your free resources",
  "income-calculator": "your income calculator",
  "practice-reset-planner": "your practice reset planner",
  footer: "the sign-up at the bottom of your site",
  automation: "one of your automations",
};

function arrivalLabel(value: string, forms: AdminForm[]): string {
  if (ARRIVAL_POINTS[value]) return ARRIVAL_POINTS[value];
  if (value.startsWith("form:")) {
    const form = forms.find((f) => f.slug === value.slice("form:".length));
    return form ? `your “${form.name}” form` : "one of your forms";
  }
  return humanizeKey(value).toLowerCase();
}

/** The choices offered for a condition value, or none for a free-text one. */
function valueChoices(key: string, forms: AdminForm[]): { value: string; label: string }[] {
  if (key !== "source") return [];
  return [
    ...Object.entries(ARRIVAL_POINTS).map(([value, label]) => ({ value, label })),
    ...forms.map((f) => ({ value: `form:${f.slug}`, label: `your “${f.name}” form` })),
  ];
}

/** One stored condition, written as part of a sentence. */
function conditionSentence(key: string, value: string, forms: AdminForm[]): string {
  switch (key) {
    case "source":
      return `they came from ${arrivalLabel(value, forms)}`;
    case "name":
      return `their name is “${value}”`;
    case "email":
      return `their email address is ${value}`;
    case "courseTitle":
      return `the course is “${value}”`;
    default:
      return `${humanizeKey(key).toLowerCase()} is “${value}”`;
  }
}

/**
 * The whole "only when" rule as one line under the trigger — the replacement
 * for printing `source = apply` at her.
 */
function describeConditions(conditions: Record<string, unknown>, forms: AdminForm[]): string {
  const parts = Object.entries(conditions ?? {})
    .filter(([, value]) => String(value ?? "").trim() !== "")
    .map(([key, value]) => conditionSentence(key, String(value), forms));
  return parts.length ? `Only when ${parts.join(" and ")}.` : "";
}

/** A row in the condition editor. `custom` means she's typing her own value. */
interface ConditionRow {
  key: string;
  value: string;
  custom: boolean;
}

/* ------------------------------------------------------------- run history */

/** Why the engine skipped a step, said without naming a setting file. */
const SKIP_REASONS: Record<string, string> = {
  "no email in payload": "there was no email address to send to",
  "no email": "there was no email address",
  "NOTIFY_EMAIL not set": "your own notification address isn't set up yet",
  "no courseId": "no course was chosen",
  "no communityId": "no community was chosen",
  "missing communityId/points": "the community or the points were missing",
};

export default function Automations() {
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [active, setActive] = useState<Automation | null>(null);
  const [actions, setActions] = useState<AutomationAction[] | null>(null);
  const [runs, setRuns] = useState<AutomationRun[] | null>(null);
  const [courses, setCourses] = useState<PublicCourse[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [forms, setForms] = useState<AdminForm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoDraft, setAutoDraft] = useState<Partial<Automation> | null>(null);
  const [conditionRows, setConditionRows] = useState<ConditionRow[]>([]);
  const [actionDraft, setActionDraft] = useState<Partial<AutomationAction> | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const subjectRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    adminApi
      .growthList<Automation>("automations")
      .then((list) => {
        setAutomations(list);
        setActive((prev) => (prev ? list.find((a) => a.id === prev.id) ?? list[0] : list[0]) ?? null);
      })
      .catch(() => setError("We couldn't load your automations. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    adminApi.coursesList().then(setCourses).catch(() => undefined);
    adminApi.communities().then(setCommunities).catch(() => undefined);
    // Her own forms are loaded so "where they came from" can offer them by
    // name; without it the only honest option would be the stored tag.
    adminApi.growthList<AdminForm>("forms").then(setForms).catch(() => undefined);
  }, []);

  const loadDetail = useCallback((id: number) => {
    setActions(null);
    setRuns(null);
    adminApi.automationActions(id).then(setActions).catch(() => setActions([]));
    adminApi.automationRuns(id).then(setRuns).catch(() => setRuns([]));
  }, []);

  useEffect(() => {
    if (active) loadDetail(active.id);
  }, [active, loadDetail]);

  /**
   * Opens the editor with the saved rule unpacked into editable rows.
   *
   * Rows carry every key that was stored, including any this screen has no
   * friendly name for, so nothing she set up earlier is quietly dropped when
   * she opens the editor and saves again.
   */
  function openAutomationEditor(draft: Partial<Automation>) {
    const stored = Object.entries(draft.conditions ?? {});
    setConditionRows(
      stored.map(([key, value]) => {
        const text = String(value ?? "");
        const choices = valueChoices(key, forms);
        return {
          key,
          value: text,
          custom: text !== "" && !choices.some((c) => c.value === text),
        };
      }),
    );
    setAutoDraft(draft);
  }

  async function saveAutomation(e: FormEvent) {
    e.preventDefault();
    if (!autoDraft?.name?.trim() || !autoDraft.triggerType) return;

    // Rebuilt from the rows rather than merged, because the rows were seeded
    // from every stored key — removing one here is the only way to remove one.
    const conditions: Record<string, string> = {};
    for (const row of conditionRows) {
      const key = row.key.trim();
      if (key) conditions[key] = row.value.trim();
    }

    try {
      const payload = { ...autoDraft, conditions };
      if (autoDraft.id) await adminApi.growthUpdate("automations", autoDraft.id, payload);
      else await adminApi.growthCreate("automations", payload);
      toast.success("Saved.");
      setAutoDraft(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "automation"));
    }
  }

  async function saveAction(e: FormEvent) {
    e.preventDefault();
    if (!actionDraft?.actionType || !active) return;
    const payload = {
      ...actionDraft,
      automationId: active.id,
      sort: actionDraft.sort ?? (actions?.length ?? 0),
    };
    try {
      if (actionDraft.id) await adminApi.growthUpdate("actions", actionDraft.id, payload);
      else await adminApi.growthCreate("actions", payload);
      toast.success("Saved.");
      setActionDraft(null);
      loadDetail(active.id);
    } catch (err) {
      toast.error(friendlyError(err, "automation"));
    }
  }

  async function toggleStatus(automation: Automation) {
    const next = automation.status === "active" ? "paused" : "active";
    try {
      await adminApi.growthUpdate("automations", automation.id, { status: next });
      toast.success(
        next === "active" ? "This one is running again." : "This one is paused for now.",
      );
      load();
    } catch (err) {
      toast.error(friendlyError(err, "automation"));
    }
  }

  async function runTest() {
    if (!active || !testEmail.trim()) return;
    setTesting(true);
    try {
      await adminApi.automationTest(active.id, { email: testEmail.trim(), name: "Test Person" });
      toast.success("Test sent — checking what happened.");
      window.setTimeout(() => loadDetail(active.id), 1500);
    } catch {
      // Never the server's own words: a failed test is ours to explain.
      toast.error("We couldn't run that test. Please try again.");
    } finally {
      setTesting(false);
    }
  }

  /** What one saved action does, named after her own courses and communities. */
  function describeAction(action: AutomationAction): string {
    const config = action.config ?? {};

    if (action.actionType === "enroll_course") {
      const course = courses.find((c) => Number(c.id) === Number(config.courseId));
      return course ? `Put them in “${course.title}”` : "Put them in a course";
    }
    if (action.actionType === "join_community" || action.actionType === "award_points") {
      const community = communities.find((c) => c.id === Number(config.communityId));
      const where = community ? `“${community.name}”` : "your community";
      return action.actionType === "award_points"
        ? `Give them ${pluralize(Number(config.points ?? 0), "point")} in ${where}`
        : `Add them to ${where}`;
    }
    if (action.actionType === "send_email" || action.actionType === "notify_admin") {
      const subject = String(config.subject ?? "").trim();
      const who = action.actionType === "send_email" ? "Email them" : "Email me";
      return subject ? `${who}: “${subject.slice(0, 60)}”` : `${who} about it`;
    }
    return actionLabel(action.actionType);
  }

  /**
   * One line of the engine's own record of a run, turned into a sentence.
   *
   * The stored lines are written for whoever maintains the engine
   * ("enroll_course: member 12 -> course 3"), so this pulls out the part that
   * means something to her, swaps ids for the names she gave those things, and
   * never repeats a raw failure message back at her.
   */
  function describeRunLine(line: string): string {
    if (!line.includes(":")) {
      return line === "conditions not met"
        ? "Skipped — this person didn't match your rule."
        : humanizeKey(line);
    }

    const divider = line.indexOf(":");
    const type = line.slice(0, divider).trim();
    const detail = line.slice(divider + 1).trim();
    const label = actionLabel(type);

    if (detail === "unknown action type") return `${label} — this one isn't set up properly.`;
    // The engine writes "FAILED — <the error>"; the error itself is written for
    // whoever maintains it, so only the fact that it went wrong comes through.
    if (detail.startsWith("FAILED")) return `${label} — that didn't work.`;

    if (detail.startsWith("skipped")) {
      const reason = SKIP_REASONS[detail.match(/\(([^)]*)\)/)?.[1] ?? ""];
      return reason ? `${label} — skipped because ${reason}.` : `${label} — skipped.`;
    }

    const sentTo = detail.match(/^sent to (.+)$/);
    if (sentTo) {
      return type === "notify_admin" ? `Emailed you at ${sentTo[1]}.` : `Emailed ${sentTo[1]}.`;
    }

    if (type === "create_member") return "Gave them access as a member.";
    if (type === "add_subscriber") return `Added ${detail} to your email list.`;
    if (type === "enroll_course") {
      const course = courses.find(
        (c) => Number(c.id) === Number(detail.match(/course (\d+)/)?.[1]),
      );
      return course ? `Put them in “${course.title}”.` : "Put them in the course.";
    }
    if (type === "join_community") {
      const community = communities.find(
        (c) => c.id === Number(detail.match(/community (\d+)/)?.[1]),
      );
      return community ? `Added them to “${community.name}”.` : "Added them to the community.";
    }
    if (type === "award_points") {
      const points = Number(detail.match(/\+(\d+)/)?.[1] ?? 0);
      return `Gave them ${pluralize(points, "point")}.`;
    }

    return `${label} — done.`;
  }

  const selectedActionDef = ACTIONS.find((a) => a.value === actionDraft?.actionType);

  /** Which condition fields the picker offers, plus any key already stored. */
  const conditionChoices = (() => {
    const offered = TRIGGER_CONDITION_KEYS[autoDraft?.triggerType ?? ""] ?? ["email"];
    const extra = conditionRows.map((r) => r.key).filter((k) => k && !offered.includes(k));
    return [...new Set([...offered, ...extra])].map((key) => ({
      key,
      label: CONDITION_FIELDS.find((f) => f.key === key)?.label ?? humanizeKey(key),
    }));
  })();

  function updateConditionRow(index: number, patch: Partial<ConditionRow>) {
    setConditionRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  /**
   * Writes a placeholder into the subject or the message wherever the cursor
   * is. The mail engine swaps these for the person's real details when it
   * sends, and she should never have to remember how they're spelled.
   */
  function insertPlaceholder(
    el: HTMLInputElement | HTMLTextAreaElement | null,
    token: string,
    apply: (value: string) => void,
  ) {
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    apply(`${el.value.slice(0, start)}${token}${el.value.slice(end)}`);
    window.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const arrivalListId = useId();
  const conditionSummary = active ? describeConditions(active.conditions ?? {}, forms) : "";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Automations (old)"
        description="The earlier automations screen, kept reachable while anything still uses it."
        actions={
          <Button
            size="sm"
            onClick={() => openAutomationEditor({ triggerType: "lead_created", status: "active" })}
          >
            <Plus />
            New automation
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      {automations === null ? (
        <Skeleton className="h-64 w-full" />
      ) : automations.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Workflow />}
            title="Nothing set up yet"
            description="Let the dashboard do the follow-up for you — a welcome email, course access, an invite to your community."
            action={
              <Button
                size="sm"
                onClick={() =>
                  openAutomationEditor({ triggerType: "lead_created", status: "active" })
                }
              >
                Set up the first one
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader title="Your automations" />
            <ul className="space-y-0.5 p-2">
              {automations.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setActive(a)}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                      active?.id === a.id ? "bg-lilac-tint" : "hover:bg-cream",
                    )}
                  >
                    <span
                      title={a.status === "active" ? "Running" : "Paused"}
                      className={cn(
                        "mt-1 size-2 shrink-0 rounded-full",
                        a.status === "active" ? "bg-green" : "bg-ink-soft/40",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm",
                          active?.id === a.id
                            ? "font-semibold text-plum-deep"
                            : "text-ink-soft",
                        )}
                      >
                        {a.name}
                      </span>
                      <span className="block truncate text-[0.68rem] text-ink-soft/70">
                        {a.runCount > 0
                          ? `Used ${pluralize(a.runCount, "time")}`
                          : "Hasn't happened yet"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-5">
            {active && (
              <>
                <Card>
                  <CardHeader
                    title={active.name}
                    subtitle={active.description || undefined}
                    icon={<Zap className="size-4" />}
                    action={
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => toggleStatus(active)}
                        >
                          {active.status === "active" ? <Pause /> : <Play />}
                          {active.status === "active" ? "Pause this" : "Turn it back on"}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openAutomationEditor(active)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="dangerGhost"
                          size="iconSm"
                          aria-label="Delete this automation"
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Delete “${active.name}”?`,
                              description:
                                "Everything it does, and the record of what it has done, goes too.",
                              confirmLabel: "Yes, delete it",
                              destructive: true,
                            });
                            if (!ok) return;
                            try {
                              await adminApi.growthDelete("automations", active.id);
                              setActive(null);
                              load();
                            } catch (err) {
                              toast.error(friendlyError(err, "automation"));
                            }
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    }
                  />

                  <div className="p-5">
                    <div className="rounded-xl border-2 border-plum/25 bg-lilac-tint/40 p-4">
                      <p className="text-[0.66rem] font-bold uppercase tracking-[0.14em] text-plum">
                        When this happens
                      </p>
                      <p className="mt-1 font-semibold text-ink">
                        {triggerLabel(active.triggerType)}
                      </p>
                      {conditionSummary && (
                        <p className="mt-1.5 text-xs text-ink-soft">{conditionSummary}</p>
                      )}
                    </div>

                    <div className="flex justify-center py-2">
                      <ArrowDown className="size-4 text-ink-soft/40" />
                    </div>

                    <p className="mb-2 text-[0.66rem] font-bold uppercase tracking-[0.14em] text-gold">
                      Do this
                    </p>

                    {actions === null ? (
                      <Skeleton className="h-20 w-full" />
                    ) : actions.length === 0 ? (
                      <div className="rounded-xl border-2 border-dashed border-hairline p-6 text-center">
                        <p className="text-sm text-ink-soft">Nothing happens yet.</p>
                        <Button
                          size="sm"
                          className="mt-3"
                          onClick={() => setActionDraft({ actionType: "send_email", config: {} })}
                        >
                          <Plus />
                          Add the first thing to do
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-0">
                        {actions.map((action, i) => (
                          <div key={action.id}>
                            <motion.div
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-4"
                            >
                              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gold/[0.12] text-xs font-bold text-gold">
                                {i + 1}
                              </span>
                              <button
                                type="button"
                                onClick={() => setActionDraft(action)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <span className="block truncate text-sm font-semibold text-ink">
                                  {describeAction(action)}
                                </span>
                              </button>
                              <Button
                                variant="dangerGhost"
                                size="iconSm"
                                aria-label={`Remove “${describeAction(action)}”`}
                                onClick={async () => {
                                  // The step holds the whole message she wrote;
                                  // one stray click used to take it with no
                                  // dialog and nothing to undo.
                                  const ok = await confirm({
                                    title: "Remove this step?",
                                    description: describeAction(action),
                                    confirmLabel: "Yes, remove it",
                                    destructive: true,
                                  });
                                  if (!ok) return;
                                  try {
                                    await adminApi.growthDelete("actions", action.id);
                                    loadDetail(active.id);
                                  } catch (err) {
                                    toast.error(friendlyError(err, "automation"));
                                  }
                                }}
                              >
                                <Trash2 />
                              </Button>
                            </motion.div>
                            {i < actions.length - 1 && (
                              <div className="flex justify-center py-1.5">
                                <ArrowDown className="size-4 text-ink-soft/40" />
                              </div>
                            )}
                          </div>
                        ))}
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-3 w-full"
                          onClick={() => setActionDraft({ actionType: "send_email", config: {} })}
                        >
                          <Plus />
                          Add another thing to do
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Try it out" icon={<CirclePlay className="size-4" />} />
                  <div className="flex flex-wrap items-end gap-3 p-5">
                    <Field
                      label="Send the test to"
                      hint="use your own address"
                      className="min-w-0 flex-1"
                    >
                      <Input
                        type="email"
                        value={testEmail}
                        onChange={(e) => setTestEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </Field>
                    <Button onClick={runTest} disabled={testing || !testEmail.trim()}>
                      <CirclePlay />
                      {testing ? "Sending…" : "Send a test"}
                    </Button>
                  </div>
                  <p className="px-5 pb-4 text-xs text-ink-soft">
                    This does the real thing: it will actually send the email and add the person.
                  </p>
                </Card>

                <Card>
                  <CardHeader
                    title="Activity"
                    subtitle={
                      active.lastRunAt
                        ? `Last happened ${formatRelative(active.lastRunAt)}`
                        : "Hasn't happened yet"
                    }
                  />
                  {runs === null ? (
                    <Skeleton className="m-5 h-16" />
                  ) : runs.length === 0 ? (
                    <EmptyState
                      icon={<Workflow />}
                      title="Nothing yet"
                      description="This fills in as people come through."
                    />
                  ) : (
                    <ul className="divide-y divide-hairline/60">
                      {runs.slice(0, 20).map((run) => (
                        <li key={run.id} className="px-5 py-3.5">
                          <div className="flex flex-wrap items-center gap-3">
                            {run.status === "success" ? (
                              <CheckCircle2 className="size-4 shrink-0 text-green" />
                            ) : run.status === "failed" ? (
                              <XCircle className="size-4 shrink-0 text-red-300" />
                            ) : (
                              <span className="size-4 shrink-0 rounded-full border-2 border-ink-soft/30" />
                            )}
                            <span className="min-w-0 flex-1 truncate text-sm text-ink">
                              {run.subjectEmail || "No email recorded"}
                            </span>
                            <Badge tone={RUN_TONE[run.status] ?? "neutral"}>
                              {RUN_LABEL[run.status] ?? humanizeKey(run.status)}
                            </Badge>
                            <span className="text-xs text-ink-soft">
                              {formatRelative(run.createdAt)}
                            </span>
                          </div>
                          {Array.isArray(run.log) && run.log.length > 0 && (
                            <ul className="ml-7 mt-1.5 space-y-0.5">
                              {run.log.map((line, i) => (
                                <li key={i} className="text-xs text-ink-soft">
                                  {describeRunLine(line)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      {/* Automation editor */}
      <Modal
        open={autoDraft !== null}
        onOpenChange={(open) => !open && setAutoDraft(null)}
        title={autoDraft?.id ? "Edit this automation" : "Set up an automation"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAutoDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="auto-form">
              Save
            </Button>
          </>
        }
      >
        {autoDraft && (
          <form id="auto-form" onSubmit={saveAutomation} className="space-y-4">
            <Field label="Name this automation" hint="just so you can find it">
              <Input
                value={autoDraft.name ?? ""}
                onChange={(e) => setAutoDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Welcome new applicants"
                required
                autoFocus
              />
            </Field>
            <Field label="What's it for?" hint="a note to yourself">
              <Textarea
                rows={2}
                value={autoDraft.description ?? ""}
                onChange={(e) => setAutoDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </Field>

            <Field label="When this happens">
              <div className="space-y-2">
                {TRIGGERS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setAutoDraft((d) => ({ ...d, triggerType: t.value }))}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                      autoDraft.triggerType === t.value
                        ? "border-plum bg-lilac-tint/50"
                        : "border-hairline hover:border-plum/40",
                    )}
                  >
                    <Zap
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        autoDraft.triggerType === t.value ? "text-plum" : "text-ink-soft/50",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{t.label}</span>
                      {t.hint && <span className="block text-xs text-ink-soft">{t.hint}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Only run this when…" hint="optional">
              <div className="space-y-2">
                {conditionRows.length === 0 ? (
                  <p className="text-xs text-ink-soft">
                    It runs every single time right now. Add something below if you only want it
                    sometimes.
                  </p>
                ) : (
                  conditionRows.map((row, i) => {
                    const choices = valueChoices(row.key, forms);
                    return (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <select
                          value={row.key}
                          aria-label="What to check"
                          onChange={(e) =>
                            updateConditionRow(i, { key: e.target.value, value: "", custom: false })
                          }
                          className={cn(selectStyles, "min-w-[10rem] flex-1 w-auto")}
                        >
                          {conditionChoices.map((choice) => (
                            <option key={choice.key} value={choice.key}>
                              {choice.label}
                            </option>
                          ))}
                        </select>
                        <span className="text-xs text-ink-soft">is</span>
                        {choices.length > 0 && !row.custom ? (
                          <select
                            value={row.value}
                            aria-label="What it has to be"
                            onChange={(e) =>
                              e.target.value === "__other__"
                                ? updateConditionRow(i, { value: "", custom: true })
                                : updateConditionRow(i, { value: e.target.value })
                            }
                            className={cn(selectStyles, "min-w-[10rem] flex-1 w-auto")}
                          >
                            <option value="">Choose one…</option>
                            {choices.map((choice) => (
                              <option key={choice.value} value={choice.value}>
                                {choice.label}
                              </option>
                            ))}
                            <option value="__other__">Something else…</option>
                          </select>
                        ) : (
                          <Input
                            className="min-w-[10rem] flex-1"
                            aria-label="What it has to be"
                            list={row.key === "source" ? arrivalListId : undefined}
                            value={row.value}
                            onChange={(e) => updateConditionRow(i, { value: e.target.value })}
                          />
                        )}
                        {choices.length > 0 && row.custom && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => updateConditionRow(i, { value: "", custom: false })}
                          >
                            Pick from the list
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="dangerGhost"
                          size="iconSm"
                          aria-label="Remove this condition"
                          onClick={() =>
                            setConditionRows((rows) => rows.filter((_, idx) => idx !== i))
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    );
                  })
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setConditionRows((rows) => [
                      ...rows,
                      { key: conditionChoices[0]?.key ?? "email", value: "", custom: false },
                    ])
                  }
                >
                  <Plus />
                  Add a condition
                </Button>
                {/* Suggestions for a typed arrival point, so she can still name
                    one this screen doesn't know about without losing the list. */}
                <datalist id={arrivalListId}>
                  {valueChoices("source", forms).map((choice) => (
                    <option key={choice.value} value={choice.value} label={choice.label} />
                  ))}
                </datalist>
              </div>
            </Field>
          </form>
        )}
      </Modal>

      {/* What happens editor */}
      <Modal
        open={actionDraft !== null}
        onOpenChange={(open) => !open && setActionDraft(null)}
        title={actionDraft?.id ? "Edit what happens" : "Add something to happen"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setActionDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="action-form">
              Save
            </Button>
          </>
        }
      >
        {actionDraft && (
          <form id="action-form" onSubmit={saveAction} className="space-y-4">
            <Field label="Do this">
              <select
                value={actionDraft.actionType ?? "send_email"}
                onChange={(e) =>
                  setActionDraft((d) => ({ ...d, actionType: e.target.value, config: {} }))
                }
                className={selectStyles}
              >
                {ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>

            {selectedActionDef?.needs.includes("subject") && (
              <Field label="Subject line" hint="the line they see in their inbox">
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      insertPlaceholder(subjectRef.current, "{{name}}", (value) =>
                        setActionDraft((d) => ({ ...d, config: { ...d?.config, subject: value } })),
                      )
                    }
                  >
                    Add their name
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      insertPlaceholder(subjectRef.current, "{{email}}", (value) =>
                        setActionDraft((d) => ({ ...d, config: { ...d?.config, subject: value } })),
                      )
                    }
                  >
                    Add their email
                  </Button>
                </div>
                <Input
                  ref={subjectRef}
                  value={String(actionDraft.config?.subject ?? "")}
                  onChange={(e) =>
                    setActionDraft((d) => ({
                      ...d,
                      config: { ...d?.config, subject: e.target.value },
                    }))
                  }
                />
              </Field>
            )}

            {selectedActionDef?.needs.includes("body") && (
              <Field label="Message" hint="we'll fill in their real details where you add them">
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      insertPlaceholder(messageRef.current, "{{name}}", (value) =>
                        setActionDraft((d) => ({ ...d, config: { ...d?.config, body: value } })),
                      )
                    }
                  >
                    Add their name
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      insertPlaceholder(messageRef.current, "{{email}}", (value) =>
                        setActionDraft((d) => ({ ...d, config: { ...d?.config, body: value } })),
                      )
                    }
                  >
                    Add their email
                  </Button>
                </div>
                <Textarea
                  ref={messageRef}
                  rows={6}
                  value={String(actionDraft.config?.body ?? "")}
                  onChange={(e) =>
                    setActionDraft((d) => ({
                      ...d,
                      config: { ...d?.config, body: e.target.value },
                    }))
                  }
                  placeholder={"Hi there,\n\nThanks for reaching out…"}
                />
              </Field>
            )}

            {selectedActionDef?.needs.includes("courseId") && (
              <Field label="Which course?">
                <select
                  value={String(actionDraft.config?.courseId ?? "")}
                  onChange={(e) =>
                    setActionDraft((d) => ({
                      ...d,
                      config: { ...d?.config, courseId: Number(e.target.value) },
                    }))
                  }
                  className={selectStyles}
                >
                  <option value="">Choose a course…</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {selectedActionDef?.needs.includes("communityId") && (
              <Field label="Which community?">
                <select
                  value={String(actionDraft.config?.communityId ?? "")}
                  onChange={(e) =>
                    setActionDraft((d) => ({
                      ...d,
                      config: { ...d?.config, communityId: Number(e.target.value) },
                    }))
                  }
                  className={selectStyles}
                >
                  <option value="">Choose a community…</option>
                  {communities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {selectedActionDef?.needs.includes("points") && (
              <Field label="How many points?">
                <Input
                  type="number"
                  min={1}
                  value={Number(actionDraft.config?.points ?? 10)}
                  onChange={(e) =>
                    setActionDraft((d) => ({
                      ...d,
                      config: { ...d?.config, points: Number(e.target.value) },
                    }))
                  }
                />
              </Field>
            )}

            {selectedActionDef?.needs.includes("source") && (
              <Field
                label="Label this sign-up as"
                hint="so you can see later where they came from"
              >
                <Input
                  value={String(actionDraft.config?.source ?? "Added automatically")}
                  onChange={(e) =>
                    setActionDraft((d) => ({
                      ...d,
                      config: { ...d?.config, source: e.target.value },
                    }))
                  }
                />
              </Field>
            )}
          </form>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
