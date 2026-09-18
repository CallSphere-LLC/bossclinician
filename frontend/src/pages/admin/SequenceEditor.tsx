import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Clock,
  Copy,
  Mail,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  UserMinus,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  describeWait,
  marketingApi,
  minutesToTimeInput,
  splitWait,
  timeInputToMinutes,
  type NamedOption,
  type Sequence,
  type SequenceEmail,
  type SequenceEmailStats,
  type SequenceSubscriber,
} from "@/lib/marketingApi";
import type { SequenceSubscriberStats } from "@/types/admin";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  chipRowStyles,
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
import EmailComposer from "@/components/admin/EmailComposer";
import {
  SEQUENCE_EMAIL_FIELDS,
  SEQUENCE_EMAIL_FIELD_IDS,
  orderedErrors,
  saveBlockedSummary,
  validateSequenceEmailDraft,
} from "@/components/admin/emailDraftValidation";

/**
 * One sequence: its emails, its sending rules, and who is going through it.
 *
 * The rules are the part worth being careful about. "Only send on weekdays"
 * and "only between 9am and 5pm" are two switches here and a fortnight of
 * arithmetic behind them, and the wording has to promise exactly what the
 * scheduler does — an email held until Monday morning is a surprise if the
 * screen said it would go out in three days.
 */

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Australia/Sydney",
];

interface EmailDraft {
  id?: number;
  subject: string;
  previewText: string;
  bodyMd: string;
  waitDays: number;
  waitHours: number;
  enabled: boolean;
}

const BLANK_EMAIL: EmailDraft = {
  subject: "",
  previewText: "",
  bodyMd: "",
  waitDays: 1,
  waitHours: 0,
  enabled: true,
};

/**
 * The reason recorded when somebody left, in words.
 *
 * Most are already plain ("bought something", "removed by hand"). The one that
 * is not is an automation's, which is stored with its number.
 */
function describeExitReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) return "no reason recorded";
  if (/^automation \d+$/i.test(trimmed)) return "taken off by an automation";
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

export default function SequenceEditor() {
  const params = useParams<{ id: string }>();
  const sequenceId = Number(params.id);

  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [tags, setTags] = useState<NamedOption[]>([]);
  const [subscribers, setSubscribers] = useState<SequenceSubscriber[] | null>(null);
  const [stats, setStats] = useState<SequenceEmailStats[]>([]);
  const [subscriberStats, setSubscriberStats] = useState<SequenceSubscriberStats | null>(null);
  const [offers, setOffers] = useState<NamedOption[]>([]);
  const [forms, setForms] = useState<NamedOption[]>([]);
  /** The specific "stop when they…" rules. null until they have loaded. */
  const [excludes, setExcludes] = useState<{ offers: NamedOption[]; forms: NamedOption[] } | null>(
    null,
  );
  const [excludesError, setExcludesError] = useState(false);
  const [savingExcludes, setSavingExcludes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmailDraft | null>(null);
  const [showEmailErrors, setShowEmailErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testAddress, setTestAddress] = useState("");
  const [testAddressError, setTestAddressError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    if (!Number.isFinite(sequenceId)) return;
    marketingApi
      .sequence(sequenceId)
      .then((row) => {
        setSequence(row);
        setError(null);
      })
      .catch(() => setError("We couldn't load this sequence just now."));
    marketingApi.sequenceSubscribers(sequenceId).then(setSubscribers).catch(() => setSubscribers([]));
    adminApi
      .sequenceStats(sequenceId)
      .then((report) => {
        setStats(report.emails);
        setSubscriberStats(report.subscribers);
      })
      .catch(() => {
        setStats([]);
        setSubscriberStats(null);
      });
  }, [sequenceId]);

  useEffect(load, [load]);

  useEffect(() => {
    marketingApi
      .builderOptions()
      .then((options) => {
        setTags(options.lists.tags ?? []);
        setOffers(options.lists.offers ?? []);
        setForms(options.lists.forms ?? []);
      })
      .catch(() => {
        setTags([]);
        setOffers([]);
        setForms([]);
      });
  }, []);

  const loadExcludes = useCallback(() => {
    if (!Number.isFinite(sequenceId)) return;
    adminApi
      .sequenceExcludes(sequenceId)
      .then((saved) => {
        setExcludes({
          offers: saved.offers.map((offer) => ({ id: offer.id, name: offer.title })),
          forms: saved.forms,
        });
        setExcludesError(false);
      })
      .catch(() => setExcludesError(true));
  }, [sequenceId]);

  useEffect(loadExcludes, [loadExcludes]);

  /**
   * Both lists go up together on every change — the server replaces them as a
   * pair — and the chips wait for the answer, so two quick presses cannot save
   * over one another.
   */
  async function toggleExclude(kind: "offers" | "forms", option: NamedOption) {
    if (!sequence || !excludes || savingExcludes) return;
    const current = excludes[kind];
    const next = {
      ...excludes,
      [kind]: current.some((row) => row.id === option.id)
        ? current.filter((row) => row.id !== option.id)
        : [...current, option],
    };

    setExcludes(next);
    setSavingExcludes(true);
    try {
      await adminApi.sequenceExcludesSave(
        sequence.id,
        next.offers.map((row) => row.id),
        next.forms.map((row) => row.id),
      );
    } catch (err) {
      toast.error(friendlyError(err, "sequence"));
      loadExcludes();
    } finally {
      setSavingExcludes(false);
    }
  }

  async function saveFolder(value: string) {
    if (!sequence) return;
    const folder = value.trim();
    if (folder === (sequence.folder ?? "")) return;
    try {
      await adminApi.sequenceSetFolder(sequence.id, folder);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "sequence"));
    }
  }

  async function duplicateEmail(email: SequenceEmail) {
    if (!sequence) return;
    try {
      await adminApi.sequenceEmailDuplicate(sequence.id, email.id);
      toast.success("Copied. The copy is turned off until you have edited it.");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "email"));
    }
  }

  async function patch(changes: Parameters<typeof marketingApi.updateSequence>[1]) {
    if (!sequence) return;
    try {
      await marketingApi.updateSequence(sequence.id, changes);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "sequence"));
    }
  }

  async function saveEmail(event: FormEvent) {
    event.preventDefault();
    if (!sequence || !editing) return;
    // A1 class: `required` on the subject and max={23} on the hours box let
    // the browser cancel this submit without a word. The form is noValidate
    // now and every refusal is named next to its field.
    const fieldErrors = validateSequenceEmailDraft(editing);
    const summary = saveBlockedSummary(fieldErrors, SEQUENCE_EMAIL_FIELDS);
    if (summary) {
      setShowEmailErrors(true);
      toast.error(summary);
      const [first] = orderedErrors(fieldErrors, SEQUENCE_EMAIL_FIELDS);
      document.getElementById(SEQUENCE_EMAIL_FIELD_IDS[first.field])?.focus();
      return;
    }

    setSaving(true);
    const draft = {
      subject: editing.subject.trim(),
      previewText: editing.previewText,
      bodyMd: editing.bodyMd,
      waitDays: editing.waitDays,
      waitHours: editing.waitHours,
      enabled: editing.enabled,
    };

    try {
      if (editing.id) {
        await marketingApi.updateSequenceEmail(sequence.id, editing.id, draft);
      } else {
        await marketingApi.addSequenceEmail(sequence.id, draft);
      }
      toast.success(editing.id ? "Email saved" : "Email added");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "email"));
    } finally {
      setSaving(false);
    }
  }

  async function removeEmail(email: SequenceEmail) {
    if (!sequence) return;
    const ok = await confirm({
      title: "Delete this email?",
      description: `"${email.subject || "Untitled"}" will be removed from the sequence. Anybody part-way through will simply skip it.`,
      confirmLabel: "Delete it",
      destructive: true,
    });
    if (!ok) return;

    try {
      await marketingApi.deleteSequenceEmail(sequence.id, email.id);
      toast.success("Email deleted");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "email"));
    }
  }

  async function move(index: number, direction: -1 | 1) {
    if (!sequence) return;
    const order = sequence.emails.map((email) => email.id);
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];

    try {
      await marketingApi.reorderSequenceEmails(sequence.id, order);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "sequence"));
    }
  }

  async function sendTest(event: FormEvent) {
    event.preventDefault();
    if (!sequence || testingId === null) return;
    // Was `type="email" required`, which the browser enforced in silence.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testAddress.trim())) {
      setTestAddressError(
        testAddress.trim()
          ? "That doesn't look like an email address — check it for typos."
          : "Enter the address to send the test to.",
      );
      toast.error("Not sent: enter an email address to send the test to.");
      document.getElementById("sequence-test-address")?.focus();
      return;
    }
    setTestAddressError(null);
    try {
      await marketingApi.testSequenceEmail(sequence.id, testingId, testAddress.trim());
      toast.success(`Test sent to ${testAddress.trim()}`);
      setTestingId(null);
      setTestAddress("");
    } catch (err) {
      toast.error(friendlyError(err, "email"));
    }
  }

  // Messages show from the first refused Save and clear as each field is
  // fixed; closing the dialog starts the next email clean.
  const emailErrors = editing && showEmailErrors ? validateSequenceEmailDraft(editing) : {};
  const editorOpen = editing !== null;
  useEffect(() => {
    if (!editorOpen) setShowEmailErrors(false);
  }, [editorOpen]);

  if (error) return <ErrorNotice message={error} />;
  if (!sequence) return <Skeleton className="h-96 rounded-2xl" />;

  const isOn = sequence.status === "active";
  const statsFor = (emailId: number): SequenceEmailStats | undefined =>
    stats.find((row) => row.id === emailId);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Email sequence"
        title={sequence.name}
        description={sequence.description || "Emails go out in this order, spaced as you set below."}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link to="/admin/marketing/sequences">
                <ArrowLeft />
                All sequences
              </Link>
            </Button>
            <Button
              size="sm"
              variant={isOn ? "secondary" : "primary"}
              onClick={() => void patch({ status: isOn ? "paused" : "active" })}
            >
              {isOn ? <Pause /> : <Play />}
              {isOn ? "Pause sending" : "Start sending"}
            </Button>
          </div>
        }
      />

      {!isOn && (
        <Card className="border-gold/30 p-4">
          <p className="text-sm text-ink-soft">
            This sequence is paused, so nobody is being added and no emails are going out. Press
            <strong className="text-ink"> Start sending</strong> when you are happy with it.
          </p>
        </Card>
      )}

      {/* ------------------------------------------------------------ emails */}

      <Card>
        <CardHeader
          title="The emails"
          subtitle="In the order they go out. The wait on each one is counted from the email before it."
          icon={<Mail />}
          action={
            <Button size="sm" onClick={() => setEditing({ ...BLANK_EMAIL })}>
              <Plus />
              Add an email
            </Button>
          }
        />

        {sequence.emails.length === 0 ? (
          <EmptyState
            icon={<Mail />}
            title="No emails yet"
            description="Write the first one and it will go out as soon as somebody joins this sequence."
            action={
              <Button size="sm" onClick={() => setEditing({ ...BLANK_EMAIL, waitDays: 0 })}>
                <Plus />
                Write the first email
              </Button>
            }
          />
        ) : (
          <ol className="divide-y divide-hairline/60">
            {sequence.emails.map((email, index) => {
              const wait = splitWait(email.delayMinutes);
              const measured = statsFor(email.id);
              return (
                <li key={email.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4 sm:flex-nowrap">
                  <div className="flex flex-col items-center gap-1 pt-1">
                    <Button
                      size="iconSm"
                      variant="ghost"
                      aria-label="Move earlier"
                      disabled={index === 0}
                      onClick={() => void move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <span className="font-display text-sm text-ink-soft">{index + 1}</span>
                    <Button
                      size="iconSm"
                      variant="ghost"
                      aria-label="Move later"
                      disabled={index === sequence.emails.length - 1}
                      onClick={() => void move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display text-base text-ink">
                        {email.subject || "No subject yet"}
                      </p>
                      {!email.enabled && <Badge tone="slate">Turned off</Badge>}
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft">
                      <Clock className="size-3.5" />
                      {index === 0
                        ? email.delayMinutes === 0
                          ? "Goes out as soon as somebody joins"
                          : `Goes out ${describeWait(email.delayMinutes)} after somebody joins`
                        : `Goes out ${describeWait(email.delayMinutes)} than the one above`}
                    </p>
                    {measured && measured.sent > 0 && (
                      <p className="mt-1 text-xs text-ink-soft/80">
                        {formatNumber(measured.sent)} sent · {formatNumber(measured.opened)} opened ·{" "}
                        {formatNumber(measured.clicked)} clicked
                      </p>
                    )}
                  </div>

                  <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
                    <Button
                      size="iconSm"
                      variant="ghost"
                      aria-label="Send yourself a test"
                      onClick={() => setTestingId(email.id)}
                    >
                      <Send />
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setEditing({
                          id: email.id,
                          subject: email.subject,
                          previewText: email.previewText,
                          bodyMd: email.bodyMd,
                          waitDays: wait.days,
                          waitHours: wait.hours,
                          enabled: email.enabled,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="iconSm"
                      variant="ghost"
                      aria-label="Duplicate this email"
                      onClick={() => void duplicateEmail(email)}
                    >
                      <Copy />
                    </Button>
                    <Button
                      size="iconSm"
                      variant="dangerGhost"
                      aria-label="Delete this email"
                      onClick={() => void removeEmail(email)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      {/* ------------------------------------------------------ sending rules */}

      <Card>
        <CardHeader
          title="When these can go out"
          subtitle="Nothing is ever sent early — an email that comes due outside these hours waits for the next slot."
          icon={<Clock />}
        />
        <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-1 size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
              checked={sequence.skipWeekends}
              onChange={(event) => void patch({ skipWeekends: event.target.checked })}
            />
            <span>
              Weekdays only
              <span className="block text-xs text-ink-soft">
                Anything due on a Saturday or Sunday waits until Monday.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-1 size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
              checked={sequence.useContactTimezone}
              onChange={(event) => void patch({ useContactTimezone: event.target.checked })}
            />
            <span>
              Use each person's own time zone
              <span className="block text-xs text-ink-soft">
                Everyone gets it at the same hour of their morning, not yours.
              </span>
            </span>
          </label>

          <Field label="Not before" hint="Leave blank for any time">
            <Input
              type="time"
              defaultValue={minutesToTimeInput(sequence.sendWindowStartMinute)}
              onBlur={(event) =>
                void patch({ sendWindowStartMinute: timeInputToMinutes(event.target.value) })
              }
            />
          </Field>

          <Field label="Not after" hint="Leave blank for any time">
            <Input
              type="time"
              defaultValue={minutesToTimeInput(sequence.sendWindowEndMinute)}
              onBlur={(event) =>
                void patch({ sendWindowEndMinute: timeInputToMinutes(event.target.value) })
              }
            />
          </Field>

          <Field label="Your time zone" hint="Used when you are not using each person's own">
            <select
              className={selectStyles}
              value={sequence.timezone}
              onChange={(event) => void patch({ timezone: event.target.value })}
            >
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ").replace("/", " — ")}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Folder"
            hint="Optional — sequences with the same folder can be filtered together"
          >
            <Input
              key={sequence.folder ?? ""}
              defaultValue={sequence.folder ?? ""}
              maxLength={120}
              onBlur={(event) => void saveFolder(event.target.value)}
              placeholder="Launch emails"
            />
          </Field>

          <Field label="Tag them when they finish" hint="Optional">
            <select
              className={selectStyles}
              value={sequence.completionTagId ?? ""}
              onChange={(event) =>
                void patch({
                  completionTagId: event.target.value ? Number(event.target.value) : null,
                })
              }
            >
              <option value="">Don't tag them</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </Field>

          <label className="flex items-start gap-3 text-sm text-ink sm:col-span-2">
            <input
              type="checkbox"
              className="mt-1 size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
              checked={sequence.exitOnPurchase}
              onChange={(event) => void patch({ exitOnPurchase: event.target.checked })}
            />
            <span>
              Stop the moment they buy something
              <span className="block text-xs text-ink-soft">
                Strongly recommended. Selling to somebody who has just bought is the quickest way
                to lose them.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm text-ink sm:col-span-2">
            <input
              type="checkbox"
              className="mt-1 size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
              checked={sequence.allowReentry}
              onChange={(event) => void patch({ allowReentry: event.target.checked })}
            />
            <span>
              Let the same person go through this more than once
              <span className="block text-xs text-ink-soft">
                Off means somebody who has been through it before is quietly skipped.
              </span>
            </span>
          </label>
        </div>
      </Card>

      {/* ---------------------------------------------------- specific stops */}

      <Card>
        <CardHeader
          title="Don't email people who…"
          subtitle="Narrower than the switch above. Anybody who does one of these is taken off this sequence the moment they do; everybody else carries on."
          icon={<UserMinus />}
        />
        {excludesError ? (
          <p className="p-5 text-sm text-ink-soft">
            We couldn't load these just now. Refresh the page to try again.
          </p>
        ) : excludes === null ? (
          <div className="p-5">
            <Skeleton className="h-20 rounded-xl" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
            {(
              [
                {
                  kind: "offers",
                  label: "…have bought",
                  options: offers,
                  empty: "You have no offers yet.",
                },
                {
                  kind: "forms",
                  label: "…have filled in",
                  options: forms,
                  empty: "You have no forms yet.",
                },
              ] as const
            ).map((group) => {
              const chosen = excludes[group.kind];
              // Something chosen earlier and since archived is still shown, so
              // it can be taken off again.
              const options = [
                ...group.options,
                ...chosen.filter((row) => !group.options.some((option) => option.id === row.id)),
              ];
              return (
                <div key={group.kind} role="group" aria-label={`Don't email people who ${group.label.slice(1)}`}>
                  <p className="text-sm font-medium text-ink">{group.label}</p>
                  {options.length === 0 ? (
                    <p className="mt-2 text-xs text-ink-soft">{group.empty}</p>
                  ) : (
                    <div className={`${chipRowStyles} mt-3`}>
                      {options.map((option) => (
                        <Chip
                          key={option.id}
                          selected={chosen.some((row) => row.id === option.id)}
                          disabled={savingExcludes}
                          onClick={() => void toggleExclude(group.kind, option)}
                        >
                          {option.name}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------- subscribers */}

      <Card>
        <CardHeader
          title="Who is going through this"
          subtitle="The most recent five hundred."
        />
        {subscriberStats && subscriberStats.subscribed > 0 && (
          <div className="border-b border-hairline/60 px-5 py-4">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              {[
                { label: "Joined", value: subscriberStats.subscribed },
                { label: "On it now", value: subscriberStats.active + subscriberStats.paused },
                { label: "Finished", value: subscriberStats.completed },
                { label: "Left early", value: subscriberStats.exited },
                { label: "Unsubscribed", value: subscriberStats.unsubscribed },
              ].map((figure) => (
                <div key={figure.label}>
                  <dt className="text-xs text-ink-soft">{figure.label}</dt>
                  <dd className="font-display text-xl text-ink">{formatNumber(figure.value)}</dd>
                </div>
              ))}
            </dl>
            {subscriberStats.exitReasons.length > 0 && (
              <p className="mt-3 text-xs text-ink-soft">
                Why people left early:{" "}
                {subscriberStats.exitReasons
                  .map(
                    (row) =>
                      `${describeExitReason(row.reason)} (${formatNumber(row.count)})`,
                  )
                  .join(" · ")}
              </p>
            )}
          </div>
        )}
        {subscribers === null ? (
          <div className="p-5">
            <Skeleton className="h-24 rounded-xl" />
          </div>
        ) : subscribers.length === 0 ? (
          <EmptyState
            icon={<Mail />}
            title="Nobody yet"
            description="People arrive here from an automation, a form, or by being added by hand."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-hairline/60 text-left text-xs text-ink-soft">
                <tr>
                  <th className="px-5 py-3 font-semibold">Who</th>
                  <th className="px-5 py-3 font-semibold">Where they are</th>
                  <th className="px-5 py-3 font-semibold">Next email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline/60">
                {subscribers.slice(0, 25).map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-3">
                      <span className="text-ink">{row.name || row.email}</span>
                      {row.name && (
                        <span className="block text-xs text-ink-soft">{row.email}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink-soft">
                      {row.status === "active"
                        ? `On email ${row.position}`
                        : row.status === "completed"
                          ? "Finished"
                          : "Left early"}
                    </td>
                    <td className="px-5 py-3 text-ink-soft">
                      {row.nextSendAt ? formatDateTime(row.nextSendAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------------ modals */}

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? "Edit this email" : "Add an email"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="sequence-email-form" disabled={saving}>
              {saving ? "Saving…" : "Save email"}
            </Button>
          </>
        }
      >
        {editing && (
          <form
            id="sequence-email-form"
            onSubmit={saveEmail}
            noValidate
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <Field label="Subject line" className="sm:col-span-2" error={emailErrors.subject}>
              <Input
                id={SEQUENCE_EMAIL_FIELD_IDS.subject}
                value={editing.subject}
                onChange={(event) =>
                  setEditing((draft) => draft && { ...draft, subject: event.target.value })
                }
                placeholder="The one thing I wish I'd known"
                autoFocus
              />
            </Field>

            <Field
              label="Wait this many days"
              hint="Counted from the email before it"
              error={emailErrors.waitDays}
            >
              <Input
                id={SEQUENCE_EMAIL_FIELD_IDS.waitDays}
                type="number"
                min={0}
                max={365}
                value={editing.waitDays}
                onChange={(event) =>
                  setEditing(
                    (draft) => draft && { ...draft, waitDays: Number(event.target.value) || 0 },
                  )
                }
              />
            </Field>

            <Field label="…and this many hours" error={emailErrors.waitHours}>
              <Input
                id={SEQUENCE_EMAIL_FIELD_IDS.waitHours}
                type="number"
                min={0}
                max={23}
                value={editing.waitHours}
                onChange={(event) =>
                  setEditing(
                    (draft) => draft && { ...draft, waitHours: Number(event.target.value) || 0 },
                  )
                }
              />
            </Field>

            <Field
              label="Preview text"
              hint="The line shown after the subject in the inbox"
              className="sm:col-span-2"
            >
              <Input
                value={editing.previewText}
                onChange={(event) =>
                  setEditing((draft) => draft && { ...draft, previewText: event.target.value })
                }
              />
            </Field>

            <Field
              label="What the email says"
              hint="Build with text, headings, images, buttons and dividers. Use {{firstName}} to personalise it."
              className="sm:col-span-2"
            >
              <EmailComposer
                source="sequence"
                rows={12}
                value={editing.bodyMd}
                onChange={(bodyMd) =>
                  setEditing((draft) => draft && { ...draft, bodyMd })
                }
                placeholder={"Hi {{firstName}},\n\nHere's what I wanted to share…"}
              />
            </Field>

            <label className="flex items-center gap-3 text-sm text-ink sm:col-span-2">
              <input
                type="checkbox"
                className="size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
                checked={editing.enabled}
                onChange={(event) =>
                  setEditing((draft) => draft && { ...draft, enabled: event.target.checked })
                }
              />
              Include this email in the sequence
            </label>
          </form>
        )}
      </Modal>

      <Modal
        open={testingId !== null}
        onOpenChange={(open) => !open && setTestingId(null)}
        title="Send yourself a test"
        description="It goes out exactly as written, addressed to you."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setTestingId(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="sequence-test-form">
              Send it
            </Button>
          </>
        }
      >
        <form id="sequence-test-form" onSubmit={sendTest} noValidate>
          <Field label="Send to" error={testAddressError ?? undefined}>
            <Input
              id="sequence-test-address"
              type="email"
              value={testAddress}
              onChange={(event) => {
                setTestAddress(event.target.value);
                setTestAddressError(null);
              }}
              placeholder="you@yourdomain.com"
              autoFocus
            />
          </Field>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  );
}
