import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  FlaskConical,
  Pause,
  Play,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import {
  describeWait,
  marketingApi,
  type ActionDescriptor,
  type Automation,
  type AutomationAction,
  type AutomationRun,
  type AutomationSummary,
  type BuilderOptions,
  type NamedOption,
  type TriggerDescriptor,
} from "@/lib/marketingApi";
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
import { friendlyError } from "@/pages/admin/ui/friendly";

/**
 * The automation builder.
 *
 * The whole screen is built around one idea: a rule should read as a sentence.
 * "When someone submits the Offer Quiz form → if they are not already a
 * customer → add the tag Visionary and start the Visionary sequence" is a thing
 * the owner can check at a glance and correct herself. A row of dropdowns
 * labelled trigger_type, conditions and action_type is not.
 *
 * Every name on this screen comes from `/options` in one request, so nothing
 * here ever has to show an id while it waits for a second lookup.
 */

const RUN_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  success: "green",
  partial: "gold",
  failed: "red",
  skipped: "slate",
  waiting: "blue",
  running: "blue",
};

const RUN_LABEL: Record<string, string> = {
  success: "Ran fine",
  partial: "Ran, with a problem",
  failed: "Didn't run",
  skipped: "Skipped",
  waiting: "Waiting",
  running: "Running now",
};

/** Which list of names an action picks from, and under which key it stores it. */
const ACTION_TARGET: Record<string, { key: string; list: string; label: string }> = {
  subscribe_sequence: { key: "sequenceId", list: "sequences", label: "Which sequence" },
  unsubscribe_sequence: { key: "sequenceId", list: "sequences", label: "Which sequence" },
  add_tag: { key: "tagId", list: "tags", label: "Which tag" },
  remove_tag: { key: "tagId", list: "tags", label: "Which tag" },
  grant_offer: { key: "offerId", list: "offers", label: "Which offer" },
  revoke_offer: { key: "offerId", list: "offers", label: "Which offer" },
  register_event: { key: "eventId", list: "events", label: "Which event" },
};

interface ConditionRule {
  field: string;
  op: string;
  value: string | number | null;
}

const CONDITION_CHOICES = [
  { id: "tag_has", label: "they already have the tag", field: "tag", op: "has", list: "tags" },
  { id: "tag_not", label: "they do not have the tag", field: "tag", op: "not_has", list: "tags" },
  { id: "customer_is", label: "they are already a customer", field: "customer", op: "is", list: "" },
  {
    id: "customer_not",
    label: "they are not a customer yet",
    field: "customer",
    op: "is_not",
    list: "",
  },
  {
    id: "sequence_in",
    label: "they are already on the sequence",
    field: "in_sequence",
    op: "has",
    list: "sequences",
  },
  {
    id: "sequence_not",
    label: "they are not on the sequence",
    field: "in_sequence",
    op: "not_has",
    list: "sequences",
  },
];

function choiceFor(rule: ConditionRule): string {
  return (
    CONDITION_CHOICES.find((choice) => choice.field === rule.field && choice.op === rule.op)?.id ??
    CONDITION_CHOICES[0].id
  );
}

function readRules(conditions: unknown): ConditionRule[] {
  if (conditions === null || typeof conditions !== "object") return [];
  const rules = (conditions as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return [];
  return rules
    .filter((rule): rule is ConditionRule => typeof rule === "object" && rule !== null)
    .map((rule) => ({ field: String(rule.field), op: String(rule.op), value: rule.value ?? null }));
}

export default function AutomationBuilder() {
  const [options, setOptions] = useState<BuilderOptions | null>(null);
  const [automations, setAutomations] = useState<AutomationSummary[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const loadList = useCallback(() => {
    marketingApi
      .automations()
      .then((rows) => {
        setAutomations(rows);
        setError(null);
      })
      .catch(() => setError("We couldn't load your automations just now."));
  }, []);

  useEffect(loadList, [loadList]);

  useEffect(() => {
    marketingApi
      .builderOptions()
      .then(setOptions)
      .catch(() => setError("We couldn't load the things an automation can use."));
  }, []);

  async function create(name: string, triggerType: string) {
    try {
      const created = await marketingApi.createAutomation({ name, triggerType });
      toast.success("Automation created — it starts paused so you can build it safely.");
      setCreating(false);
      loadList();
      setOpenId(created.id);
    } catch (err) {
      toast.error(friendlyError(err, "automation"));
    }
  }

  async function remove(automation: AutomationSummary) {
    const ok = await confirm({
      title: `Delete "${automation.name}"?`,
      description: "Its history goes with it. Pausing it instead keeps the record.",
      confirmLabel: "Delete it",
      destructive: true,
    });
    if (!ok) return;

    try {
      await marketingApi.deleteAutomation(automation.id);
      toast.success("Automation deleted");
      loadList();
    } catch (err) {
      toast.error(friendlyError(err, "automation"));
    }
  }

  if (openId !== null && options) {
    return (
      <AutomationDetail
        automationId={openId}
        options={options}
        onBack={() => {
          setOpenId(null);
          loadList();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Automations"
        description="Rules that run themselves. When something happens, check a condition, then do something about it."
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={!options}>
            <Plus />
            New automation
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      {automations === null ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : automations.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Workflow />}
            title="No automations yet"
            description="Set one up and it will keep working while you are with clients."
            action={
              <Button size="sm" onClick={() => setCreating(true)} disabled={!options}>
                <Plus />
                New automation
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          {automations.map((automation, index) => (
            <motion.div
              key={automation.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.05, 0.3) }}
            >
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="font-display text-lg text-ink hover:text-gold"
                      onClick={() => setOpenId(automation.id)}
                    >
                      {automation.name}
                    </button>
                    <p className="mt-2 text-sm text-ink">{automation.triggerSentence}</p>
                    {automation.actionSentences.length === 0 ? (
                      <p className="mt-1 text-sm text-ink-soft">
                        …then nothing yet. Add a step to make this do something.
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-0.5 text-sm text-ink-soft">
                        {automation.actionSentences.map((sentence, position) => (
                          <li key={position}>→ {sentence}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={automation.status === "active" ? "green" : "slate"}>
                      {automation.status === "active" ? "Running" : "Paused"}
                    </Badge>
                    <Button size="sm" variant="secondary" onClick={() => setOpenId(automation.id)}>
                      Open
                    </Button>
                    <Button
                      size="iconSm"
                      variant="dangerGhost"
                      aria-label={`Delete ${automation.name}`}
                      onClick={() => void remove(automation)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                {automation.lastRunAt && (
                  <p className="mt-3 border-t border-hairline/60 pt-3 text-xs text-ink-soft">
                    Last ran {formatDateTime(automation.lastRunAt)} · {automation.runCount} times in
                    all
                  </p>
                )}
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {options && (
        <NewAutomationModal
          open={creating}
          triggers={options.triggers}
          onOpenChange={setCreating}
          onCreate={create}
        />
      )}

      {confirmDialog}
    </div>
  );
}

/* ------------------------------------------------------------ new automation */

function NewAutomationModal({
  open,
  triggers,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  triggers: TriggerDescriptor[];
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, triggerType: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState(triggers[0]?.type ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await onCreate(name.trim(), triggerType);
    setSaving(false);
    setName("");
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Set up a new automation"
      description="Pick what starts it off. You can add the steps next."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="new-automation-form" disabled={saving}>
            {saving ? "Creating…" : "Create it"}
          </Button>
        </>
      }
    >
      <form id="new-automation-form" onSubmit={submit} className="grid gap-4">
        <Field label="What should this be called?" hint="Only you see this">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tag and welcome quiz takers"
            required
            autoFocus
          />
        </Field>
        <Field label="Start it when…">
          <select
            className={selectStyles}
            value={triggerType}
            onChange={(event) => setTriggerType(event.target.value)}
          >
            {triggers.map((trigger) => (
              <option key={trigger.type} value={trigger.type}>
                {trigger.label}
              </option>
            ))}
          </select>
        </Field>
      </form>
    </Modal>
  );
}

/* ----------------------------------------------------------------- detail */

function AutomationDetail({
  automationId,
  options,
  onBack,
}: {
  automationId: number;
  options: BuilderOptions;
  onBack: () => void;
}) {
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [editing, setEditing] = useState<AutomationAction | null>(null);
  const [testing, setTesting] = useState(false);
  const [testAddress, setTestAddress] = useState("");
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    marketingApi.automation(automationId).then(setAutomation).catch(() => setAutomation(null));
    marketingApi.automationRuns(automationId).then(setRuns).catch(() => setRuns([]));
  }, [automationId]);

  useEffect(load, [load]);

  const trigger = useMemo(
    () => options.triggers.find((row) => row.type === automation?.triggerType),
    [options.triggers, automation?.triggerType],
  );

  const rules = useMemo(() => readRules(automation?.conditions), [automation?.conditions]);

  async function patch(changes: Parameters<typeof marketingApi.updateAutomation>[1]) {
    try {
      await marketingApi.updateAutomation(automationId, changes);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "automation"));
    }
  }

  async function addAction(actionType: string) {
    try {
      await marketingApi.addAction(automationId, { actionType });
      load();
    } catch (err) {
      toast.error(friendlyError(err, "step"));
    }
  }

  async function removeAction(action: AutomationAction) {
    const ok = await confirm({
      title: "Remove this step?",
      description: action.sentence,
      confirmLabel: "Remove it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await marketingApi.deleteAction(automationId, action.id);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "step"));
    }
  }

  async function moveAction(index: number, direction: -1 | 1) {
    if (!automation) return;
    const order = automation.actions.map((action) => action.id);
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    try {
      await marketingApi.reorderActions(automationId, order);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "automation"));
    }
  }

  async function runTest(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await marketingApi.testAutomation(automationId, testAddress.trim());
      toast.success("Tried it — see what it would have done below.");
      setTesting(false);
      setTestAddress("");
      void result;
      load();
    } catch (err) {
      toast.error(friendlyError(err, "automation"));
    }
  }

  function setRules(next: ConditionRule[]) {
    void patch({ conditions: { match: "all", rules: next } });
  }

  if (!automation) return <Skeleton className="h-96 rounded-2xl" />;

  const isOn = automation.status === "active";
  const subjectList = trigger?.subjectSource ? (options.lists[trigger.subjectSource] ?? []) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Automation"
        title={automation.name}
        description={automation.description || "Reads top to bottom. Every step runs in order."}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onBack}>
              <ArrowLeft />
              All automations
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setTesting(true)}>
              <FlaskConical />
              Try it out
            </Button>
            <Button
              size="sm"
              variant={isOn ? "secondary" : "primary"}
              onClick={() => void patch({ status: isOn ? "paused" : "active" })}
            >
              {isOn ? <Pause /> : <Play />}
              {isOn ? "Pause it" : "Turn it on"}
            </Button>
          </div>
        }
      />

      {/* ---------------------------------------------------------- when */}

      <Card>
        <CardHeader title="When this happens" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Start it when…">
            <select
              className={selectStyles}
              value={automation.triggerType}
              onChange={(event) =>
                void patch({ triggerType: event.target.value, triggerConfig: {} })
              }
            >
              {options.triggers.map((row) => (
                <option key={row.type} value={row.type}>
                  {row.label}
                </option>
              ))}
            </select>
          </Field>

          {trigger?.subjectKey && (
            <Field label={trigger.subjectLabel} hint="Leave on 'any' to catch them all">
              <select
                className={selectStyles}
                value={String(automation.triggerConfig?.[trigger.subjectKey] ?? "")}
                onChange={(event) =>
                  void patch({
                    triggerConfig: {
                      [trigger.subjectKey]: event.target.value ? Number(event.target.value) : null,
                    },
                  })
                }
              >
                <option value="">Any</option>
                {subjectList.map((item: NamedOption) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </Card>

      {/* ------------------------------------------------------------ if */}

      <Card>
        <CardHeader
          title="…but only if"
          subtitle="Leave this empty and the automation runs for everybody."
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setRules([...rules, { field: "tag", op: "has", value: null }])}
            >
              <Plus />
              Add a condition
            </Button>
          }
        />
        {rules.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-ink-soft">No conditions — this runs for everybody.</p>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {rules.map((rule, index) => {
              const choice = CONDITION_CHOICES.find((row) => row.id === choiceFor(rule));
              const list = choice?.list ? (options.lists[choice.list] ?? []) : [];
              return (
                <li key={index} className="flex flex-wrap items-end gap-3 px-5 py-4">
                  <div className="min-w-[16rem] flex-1">
                    <select
                      className={selectStyles}
                      value={choiceFor(rule)}
                      onChange={(event) => {
                        const picked = CONDITION_CHOICES.find(
                          (row) => row.id === event.target.value,
                        );
                        if (!picked) return;
                        const next = [...rules];
                        next[index] = {
                          field: picked.field,
                          op: picked.op,
                          value: picked.list ? null : true,
                        } as ConditionRule;
                        setRules(next);
                      }}
                    >
                      {CONDITION_CHOICES.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {choice?.list && (
                    <div className="min-w-[14rem] flex-1">
                      <select
                        className={selectStyles}
                        value={String(rule.value ?? "")}
                        onChange={(event) => {
                          const next = [...rules];
                          next[index] = { ...rule, value: Number(event.target.value) || null };
                          setRules(next);
                        }}
                      >
                        <option value="">Choose one…</option>
                        {list.map((item: NamedOption) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <Button
                    size="iconSm"
                    variant="dangerGhost"
                    aria-label="Remove this condition"
                    onClick={() => setRules(rules.filter((_, position) => position !== index))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ---------------------------------------------------------- then */}

      <Card>
        <CardHeader
          title="Then do this"
          subtitle="Steps run in order, top to bottom."
          action={<AddStepMenu actions={options.actions} onPick={addAction} />}
        />

        {automation.actions.length === 0 ? (
          <EmptyState
            icon={<Workflow />}
            title="No steps yet"
            description="Add one and this automation will start doing something."
          />
        ) : (
          <ol className="divide-y divide-hairline/60">
            {automation.actions.map((action, index) => (
              <li key={action.id} className="flex items-start gap-4 px-5 py-4">
                <div className="flex flex-col items-center gap-1 pt-1">
                  <Button
                    size="iconSm"
                    variant="ghost"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => void moveAction(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <span className="font-display text-sm text-ink-soft">{index + 1}</span>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    aria-label="Move down"
                    disabled={index === automation.actions.length - 1}
                    onClick={() => void moveAction(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">→ {action.sentence}</p>
                  {action.delayMinutes > 0 && (
                    <p className="mt-1 text-xs text-ink-soft">
                      Held back {describeWait(action.delayMinutes)}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(action)}>
                    Edit
                  </Button>
                  <Button
                    size="iconSm"
                    variant="dangerGhost"
                    aria-label="Remove this step"
                    onClick={() => void removeAction(action)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* -------------------------------------------------------- history */}

      <Card>
        <CardHeader title="What it has done" subtitle="The last hundred times it ran." />
        {runs.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-ink-soft">It has not run yet.</p>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {runs.slice(0, 20).map((run) => (
              <li key={run.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={RUN_TONE[run.status] ?? "neutral"}>
                    {RUN_LABEL[run.status] ?? run.status}
                  </Badge>
                  {run.isTest && <Badge tone="plum">Practice run</Badge>}
                  <span className="text-sm text-ink">
                    {run.contactName || run.subjectEmail || "Somebody"}
                  </span>
                  <span className="text-xs text-ink-soft">{formatDateTime(run.createdAt)}</span>
                </div>
                {run.log.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">
                    {run.log.map((line, position) => (
                      <li key={position}>· {line}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && (
        <ActionModal
          action={editing}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      <Modal
        open={testing}
        onOpenChange={setTesting}
        title="Try this automation out"
        description="Nothing is actually sent or changed — each step tells you what it would have done."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setTesting(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="automation-test-form">
              Try it
            </Button>
          </>
        }
      >
        <form id="automation-test-form" onSubmit={runTest}>
          <Field label="Pretend it is this person" hint="Use your own address">
            <Input
              type="email"
              value={testAddress}
              onChange={(event) => setTestAddress(event.target.value)}
              placeholder="you@yourdomain.com"
              required
              autoFocus
            />
          </Field>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  );
}

/* ------------------------------------------------------------- add a step */

function AddStepMenu({
  actions,
  onPick,
}: {
  actions: ActionDescriptor[];
  onPick: (actionType: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");

  return (
    <div className="flex items-center gap-2">
      <select
        className={`${selectStyles} min-w-[15rem]`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label="Choose a step to add"
      >
        <option value="">Add a step…</option>
        {/* "only carry on if" has nothing to fill in on this screen, so a step
            added from it holds no conditions and lets everybody through — a gate
            she believes she set and that never closes. Hidden until it has an
            editor. */}
        {actions
          .filter((action) => action.type !== "branch")
          .map((action) => (
            <option key={action.type} value={action.type}>
              {action.label}
            </option>
          ))}
      </select>
      <Button
        size="sm"
        disabled={!value}
        onClick={() => {
          const picked = value;
          setValue("");
          void onPick(picked);
        }}
      >
        <Plus />
        Add
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------- step editor */

function ActionModal({
  action,
  options,
  onClose,
  onSaved,
}: {
  action: AutomationAction;
  options: BuilderOptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [config, setConfig] = useState<Record<string, unknown>>(action.config ?? {});
  const [delayMinutes, setDelayMinutes] = useState(action.delayMinutes);
  const [saving, setSaving] = useState(false);

  const target = ACTION_TARGET[action.actionType];
  const list = target ? (options.lists[target.list] ?? []) : [];
  const label =
    options.actions.find((row) => row.type === action.actionType)?.label ?? action.actionType;

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await marketingApi.updateAction(action.automationId, action.id, { config, delayMinutes });
      toast.success("Step saved");
      onSaved();
    } catch (err) {
      toast.error(friendlyError(err, "step"));
    } finally {
      setSaving(false);
    }
  }

  const set = (key: string, value: unknown): void =>
    setConfig((current) => ({ ...current, [key]: value }));

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Step: ${label}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="action-form" disabled={saving}>
            {saving ? "Saving…" : "Save step"}
          </Button>
        </>
      }
    >
      <form id="action-form" onSubmit={save} className="grid gap-4">
        {target && (
          <Field label={target.label}>
            <select
              className={selectStyles}
              value={String(config[target.key] ?? "")}
              onChange={(event) => set(target.key, Number(event.target.value) || null)}
              required
            >
              <option value="">Choose one…</option>
              {list.map((item: NamedOption) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {action.actionType === "send_email" && (
          <>
            <Field label="Subject line">
              <Input
                value={String(config.subject ?? "")}
                onChange={(event) => set("subject", event.target.value)}
                required
              />
            </Field>
            <Field label="What the email says" hint="Use {{firstName}} to greet them by name">
              <Textarea
                rows={10}
                value={String(config.bodyMd ?? "")}
                onChange={(event) => set("bodyMd", event.target.value)}
              />
            </Field>
          </>
        )}

        {action.actionType === "create_task" && (
          <>
            <Field label="Remind me to…">
              <Input
                value={String(config.title ?? "")}
                onChange={(event) => set("title", event.target.value)}
                placeholder="Call them about the retreat"
                required
              />
            </Field>
            <Field label="Anything else to remember" hint="Optional">
              <Textarea
                rows={3}
                value={String(config.note ?? "")}
                onChange={(event) => set("note", event.target.value)}
              />
            </Field>
          </>
        )}

        {action.actionType === "fire_webhook" && (
          <Field label="Web address to notify" hint="The other app gives you this">
            <Input
              type="url"
              value={String(config.url ?? "")}
              onChange={(event) => set("url", event.target.value)}
              placeholder="https://hooks.zapier.com/…"
              required
            />
          </Field>
        )}

        {action.actionType === "wait" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Wait this many days">
              <Input
                type="number"
                min={0}
                value={Number(config.days ?? 0)}
                onChange={(event) => set("days", Number(event.target.value) || 0)}
              />
            </Field>
            <Field label="…and this many minutes">
              <Input
                type="number"
                min={0}
                value={Number(config.minutes ?? 0)}
                onChange={(event) => set("minutes", Number(event.target.value) || 0)}
              />
            </Field>
          </div>
        )}

        {action.actionType !== "wait" && (
          <Field
            label="Hold this step back"
            hint="In minutes. Leave at 0 to do it straight away."
          >
            <Input
              type="number"
              min={0}
              value={delayMinutes}
              onChange={(event) => setDelayMinutes(Number(event.target.value) || 0)}
            />
          </Field>
        )}
      </form>
    </Modal>
  );
}
