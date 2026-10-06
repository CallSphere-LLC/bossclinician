/**
 * The Automations list's search and Filters panel, as pure functions.
 *
 * Kajabi's Automations page (QA sheet row 71) lets the owner narrow the list by
 * what starts a rule ("When"), what it does ("Then"), whether it is on, and the
 * thing it is about — and, here, whether it came over from Kajabi. All of that
 * lives in the URL (`?when=form_submitted,tag_added&status=paused&source=kajabi`)
 * so a link or the Back button lands on the same list.
 *
 * Semantics: OR inside one group (any of the chosen triggers), AND across groups.
 *
 * The rows are read through a small structural type, and the fields an older API
 * may not send (`source`, `actionTypes`, `actionRefs`) are read defensively, so
 * nothing here depends on `marketingApi.ts` having been widened.
 */

export type StatusFilter = "all" | "active" | "paused";
export type SourceFilter = "all" | "kajabi" | "local";

export interface AutomationFilters {
  /** Free text over name, description and the When/Then sentences. */
  q: string;
  /** Trigger types ("When"). */
  when: string[];
  /** Action types ("Then"). */
  then: string[];
  status: StatusFilter;
  source: SourceFilter;
  /** Related objects as `list:id` refs, e.g. `offers:12`. */
  related: string[];
}

export const EMPTY_AUTOMATION_FILTERS: AutomationFilters = {
  q: "",
  when: [],
  then: [],
  status: "all",
  source: "all",
  related: [],
};

/** Just the parts of an automation summary the filters read. */
export interface FilterableAutomation {
  name: string;
  description?: string | null;
  triggerType: string;
  triggerConfig?: Record<string, unknown> | null;
  status: string;
  triggerSentence?: string;
  actionSentences?: string[];
}

/** Which trigger subject (`formId` → `forms`) each trigger type points at. */
export interface TriggerSubject {
  type: string;
  subjectKey: string;
  subjectSource: string;
}

/* ------------------------------------------------------------ row readers */

/** "kajabi" for a rule imported from Kajabi, "local" for one made here. */
export function sourceOf(row: unknown): "kajabi" | "local" {
  const value = (row as { source?: unknown } | null)?.source;
  return typeof value === "string" && value.trim().toLowerCase() === "kajabi" ? "kajabi" : "local";
}

/** The action types of an automation's steps, in order (empty on an older API). */
export function actionTypesOf(row: unknown): string[] {
  const value = (row as { actionTypes?: unknown } | null)?.actionTypes;
  return Array.isArray(value)
    ? value.filter((type): type is string => typeof type === "string" && type !== "")
    : [];
}

/** `list:id` refs the steps point at (a tag, a sequence, an offer…). */
export function actionRefsOf(row: unknown): string[] {
  const value = (row as { actionRefs?: unknown } | null)?.actionRefs;
  return Array.isArray(value)
    ? value.filter((ref): ref is string => typeof ref === "string" && ref.includes(":"))
    : [];
}

/** The `list:id` ref of the thing the trigger watches, or null for "any". */
export function triggerRefOf(
  row: FilterableAutomation,
  triggers: readonly TriggerSubject[],
): string | null {
  const descriptor = triggers.find((trigger) => trigger.type === row.triggerType);
  if (!descriptor || !descriptor.subjectKey || !descriptor.subjectSource) return null;
  const id = Number(row.triggerConfig?.[descriptor.subjectKey]);
  return Number.isInteger(id) && id > 0 ? `${descriptor.subjectSource}:${id}` : null;
}

/** Every related-object ref of a row: the trigger's subject, then each step's target. */
export function relatedRefsOf(
  row: FilterableAutomation,
  triggers: readonly TriggerSubject[],
): string[] {
  const refs = new Set<string>();
  const triggerRef = triggerRefOf(row, triggers);
  if (triggerRef) refs.add(triggerRef);
  for (const ref of actionRefsOf(row)) refs.add(ref);
  return [...refs];
}

/* ---------------------------------------------------------------- filter */

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function matchesSearch(row: FilterableAutomation, query: string): boolean {
  const needle = normalise(query);
  if (!needle) return true;
  const haystack = normalise(
    [
      row.name ?? "",
      row.description ?? "",
      row.triggerSentence ?? "",
      ...(row.actionSentences ?? []),
    ].join(" \n "),
  );
  // Every word has to appear somewhere, in any order: "quiz visionary" finds
  // "When someone submits a form — Offer Quiz → add the tag Visionary".
  return needle.split(" ").every((word) => haystack.includes(word));
}

/**
 * The rows that pass every filter, in their original order.
 *
 * `triggers` is only needed for the "Related to" filter (to read the trigger's
 * subject out of its config); without it only the steps' targets are matched.
 */
export function filterAutomations<T extends FilterableAutomation>(
  rows: readonly T[],
  filters: AutomationFilters,
  triggers: readonly TriggerSubject[] = [],
): T[] {
  return rows.filter((row) => {
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (filters.source !== "all" && sourceOf(row) !== filters.source) return false;
    if (filters.when.length > 0 && !filters.when.includes(row.triggerType)) return false;
    if (filters.then.length > 0) {
      const types = actionTypesOf(row);
      if (!filters.then.some((type) => types.includes(type))) return false;
    }
    if (filters.related.length > 0) {
      const refs = relatedRefsOf(row, triggers);
      if (!filters.related.some((ref) => refs.includes(ref))) return false;
    }
    return matchesSearch(row, filters.q);
  });
}

/**
 * How many filters are on, counted the way the chips are drawn: one per chosen
 * trigger, action and related object, one for a status, one for a source. The
 * search box is not counted — it shows its own text.
 */
export function activeFilterCount(filters: AutomationFilters): number {
  return (
    filters.when.length +
    filters.then.length +
    filters.related.length +
    (filters.status === "all" ? 0 : 1) +
    (filters.source === "all" ? 0 : 1)
  );
}

export function hasActiveFilters(filters: AutomationFilters): boolean {
  return activeFilterCount(filters) > 0 || filters.q.trim() !== "";
}

/* ------------------------------------------------------------------- URL */

const STATUS_VALUES: readonly string[] = ["all", "active", "paused"];
const SOURCE_VALUES: readonly string[] = ["all", "kajabi", "local"];

function readList(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  if (!raw) return [];
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  return [...new Set(values)];
}

export function readAutomationFilters(params: URLSearchParams): AutomationFilters {
  const status = params.get("status") ?? "";
  const source = params.get("source") ?? "";
  return {
    q: params.get("q") ?? "",
    when: readList(params, "when"),
    then: readList(params, "then"),
    status: STATUS_VALUES.includes(status) ? (status as StatusFilter) : "all",
    source: SOURCE_VALUES.includes(source) ? (source as SourceFilter) : "all",
    related: readList(params, "related"),
  };
}

/**
 * The same params with the filters written in, every other key (such as
 * `?automation=`) left alone. Defaults are left out so a clean list has a
 * clean URL.
 */
export function writeAutomationFilters(
  params: URLSearchParams,
  filters: AutomationFilters,
): URLSearchParams {
  const next = new URLSearchParams(params);
  const setOrDelete = (key: string, value: string) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  setOrDelete("q", filters.q);
  setOrDelete("when", filters.when.join(","));
  setOrDelete("then", filters.then.join(","));
  setOrDelete("status", filters.status === "all" ? "" : filters.status);
  setOrDelete("source", filters.source === "all" ? "" : filters.source);
  setOrDelete("related", filters.related.join(","));
  return next;
}

/** Adds the value if it is missing, takes it out if it is there. */
export function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

/* ----------------------------------------------------------------- labels */

/** Kajabi's own short names for each "When", for the filter chips. */
const WHEN_LABEL: Record<string, string> = {
  form_submitted: "Form submitted",
  offer_purchased: "Offer purchased",
  sequence_completed: "Sequence completed",
  sequence_subscribed: "Subscribed to sequence",
  sequence_unsubscribed: "Unsubscribed from sequence",
  tag_added: "Tag added",
  tag_removed: "Tag removed",
  subscription_cancelled: "Subscription ended",
  subscription_cancel_requested: "Cancellation requested",
  payment_plan_completed: "Payment plan completed",
  payment_failed: "Payment failed",
  event_registered: "Event registration",
  event_attended: "Event attended",
  assessment_completed: "Quiz completed",
  assessment_passed: "Quiz passed",
  lesson_completed: "Lesson completed",
  course_completed: "Course completed",
  certificate_earned: "Certificate earned",
  coaching_session_booked: "Coaching session booked",
  community_post_created: "Community post created",
  contact_created: "Contact created",
  date_anniversary: "Anniversary",
  abandoned_checkout: "Abandoned checkout",
};

/** And for each "Then". */
const THEN_LABEL: Record<string, string> = {
  send_email: "Send email",
  subscribe_sequence: "Subscribe to sequence",
  unsubscribe_sequence: "Unsubscribe from sequence",
  add_tag: "Add tag",
  remove_tag: "Remove tag",
  grant_offer: "Grant offer",
  revoke_offer: "Revoke offer",
  register_event: "Register for event",
  create_task: "Create task",
  fire_webhook: "Send webhook",
  wait: "Wait",
  branch: "Check conditions",
};

type Described = { type: string; label: string };

function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function humanise(type: string): string {
  return capitalise(type.replace(/_/g, " "));
}

function labelFrom(
  table: Record<string, string>,
  descriptors: readonly Described[] | undefined,
  type: string,
): string {
  const known = table[type];
  if (known) return known;
  const descriptor = descriptors?.find((row) => row.type === type);
  return descriptor?.label ? capitalise(descriptor.label) : humanise(type);
}

export function whenLabel(type: string, descriptors?: readonly Described[]): string {
  return labelFrom(WHEN_LABEL, descriptors, type);
}

export function thenLabel(type: string, descriptors?: readonly Described[]): string {
  return labelFrom(THEN_LABEL, descriptors, type);
}

/** The noun for a list ("offers" → "Offer") used to prefix a related object's name. */
const LIST_NOUN: Record<string, string> = {
  tags: "Tag",
  sequences: "Sequence",
  offers: "Offer",
  forms: "Form",
  events: "Event",
  assessments: "Quiz",
  courses: "Course",
  communities: "Community",
  plans: "Plan",
  segments: "Segment",
};

/** "Offer: Visionary Bundle" for `offers:12`, using the builder's name lists. */
export function relatedLabel(
  ref: string,
  lists?: Record<string, readonly { id: number; name: string }[]>,
): string {
  const separator = ref.indexOf(":");
  const list = separator === -1 ? ref : ref.slice(0, separator);
  const rawId = separator === -1 ? "" : ref.slice(separator + 1);
  const id = Number(rawId);
  const noun = LIST_NOUN[list] ?? humanise(list);
  const name = lists?.[list]?.find((option) => option.id === id)?.name;
  return name ? `${noun}: ${name}` : `${noun} #${rawId || "?"}`;
}

/* ---------------------------------------------------------- facet options */

/**
 * The values a filter group can offer: those present in the rows, plus any
 * already chosen (so a chip from a pasted link can still be switched off),
 * sorted by their label.
 */
export function facetValues(
  present: Iterable<string>,
  chosen: readonly string[],
  label: (value: string) => string,
): string[] {
  const values = new Set<string>(present);
  for (const value of chosen) values.add(value);
  return [...values].sort((a, b) => label(a).localeCompare(label(b)));
}
