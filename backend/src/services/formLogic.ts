/**
 * Conditional questions, and the rules an answer has to meet, for public forms.
 *
 * A question can carry a `showIf` rule naming an EARLIER question and a test on
 * its answer. The public page hides a question whose rule is not met, and the
 * submit route runs exactly this code again: a hidden question is never
 * required, and whatever a client sends for one is not stored. The page is a
 * convenience; this file is the decision.
 *
 * Kept pure (no database, no request) so the whole behaviour is testable, and
 * mirrored in frontend/src/lib/formLogic.ts. The two must agree — a page that
 * shows a question the server then ignores is a visitor whose answer vanishes.
 */

export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "answered",
  "one_of",
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export interface ShowIf {
  /** Key of an earlier question. */
  field: string;
  operator: ConditionOperator;
  /** For equals / not_equals / contains. */
  value?: string;
  /** For one_of. */
  values?: string[];
}

/** As much of a stored question as this module reads. jsonb, so all optional. */
export interface LogicField {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: string[];
  minLength?: number | null;
  maxLength?: number | null;
  pattern?: string;
  showIf?: ShowIf | null;
}

export const FILE_TYPE = "file";

/** Always asked by the page itself, so never conditional and never a trigger. */
const IDENTITY_KEYS = new Set(["name", "email"]);

const CHOICE_TYPES = new Set(["select", "radio", "checkboxes"]);

/** No answer worth keeping is longer, and it bounds the pattern test below. */
export const MAX_ANSWER_CHARS = 10_000;

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function isOperator(value: unknown): value is ConditionOperator {
  return typeof value === "string" && (CONDITION_OPERATORS as readonly string[]).includes(value);
}

/** The questions in a jsonb `fields` value, skipping anything that isn't one. */
export function asFields(fields: unknown): LogicField[] {
  if (!Array.isArray(fields)) return [];
  return fields.filter(
    (field): field is LogicField =>
      !!field && typeof field === "object" && typeof (field as LogicField).key === "string",
  );
}

/** A stored rule, if it is shaped like one. */
export function readShowIf(raw: unknown): ShowIf | null {
  if (!raw || typeof raw !== "object") return null;
  const rule = raw as Record<string, unknown>;
  if (typeof rule.field !== "string" || rule.field === "") return null;
  if (!isOperator(rule.operator)) return null;
  return {
    field: rule.field,
    operator: rule.operator,
    value: typeof rule.value === "string" ? rule.value : undefined,
    values: Array.isArray(rule.values)
      ? rule.values.filter((entry): entry is string => typeof entry === "string")
      : undefined,
  };
}

/**
 * An answer as the lowercase strings it can be compared by.
 *
 * A tick box is "yes" or "no" — including when it was never touched, which is
 * the same thing as unticked. A "tick any" answer is each ticked choice. A file
 * question is answered when a file actually arrived; a value a client typed in
 * for one is not a file.
 */
export function answerTokens(field: LogicField | undefined, answer: unknown): string[] {
  if (field?.type === "checkbox") return [answer === true || answer === "true" ? "yes" : "no"];
  if (field?.type === FILE_TYPE) {
    return answer && typeof answer === "object" && !Array.isArray(answer) ? ["file"] : [];
  }
  if (Array.isArray(answer)) {
    return answer
      .filter((entry) => typeof entry === "string" || typeof entry === "number")
      .map((entry) => norm(String(entry)))
      .filter(Boolean);
  }
  if (typeof answer === "string") {
    const text = norm(answer);
    return text ? [text] : [];
  }
  if (typeof answer === "number" && Number.isFinite(answer)) return [String(answer)];
  if (answer === true) return ["yes"];
  return [];
}

export function isAnswered(field: LogicField | undefined, answer: unknown): boolean {
  if (field?.type === "checkbox") return answer === true || answer === "true";
  return answerTokens(field, answer).length > 0;
}

/** Whether one rule holds for the answer given to the question it names. */
export function conditionMet(
  rule: ShowIf,
  controller: LogicField | undefined,
  answer: unknown,
): boolean {
  const tokens = answerTokens(controller, answer);
  switch (rule.operator) {
    case "answered":
      return isAnswered(controller, answer);
    case "equals":
      return tokens.includes(norm(rule.value ?? ""));
    case "not_equals":
      return !tokens.includes(norm(rule.value ?? ""));
    case "contains": {
      const needle = norm(rule.value ?? "");
      return needle !== "" && tokens.some((token) => token.includes(needle));
    }
    case "one_of": {
      const wanted = (rule.values ?? []).map(norm).filter(Boolean);
      return tokens.some((token) => wanted.includes(token));
    }
    default:
      return true;
  }
}

/**
 * The keys of the questions somebody with these answers is actually shown.
 *
 * In order, because a rule may only name a question above it: a question whose
 * trigger is itself hidden is hidden too, whatever the trigger's stale value
 * says. A rule that names no earlier question (which the builder refuses to
 * save) leaves the question showing, so a bad row can never hide a question for
 * good.
 */
export function visibleQuestionKeys(fields: unknown, data: Record<string, unknown>): Set<string> {
  const earlier = new Map<string, LogicField>();
  const visible = new Set<string>();

  for (const field of asFields(fields)) {
    const rule = IDENTITY_KEYS.has(field.key) ? null : readShowIf(field.showIf);
    let shown = true;
    if (rule) {
      const controller = earlier.get(rule.field);
      if (controller) {
        shown = visible.has(controller.key) && conditionMet(rule, controller, data[controller.key]);
      }
    }
    if (shown) visible.add(field.key);
    earlier.set(field.key, field);
  }
  return visible;
}

/** The tests that make sense for an answer of this type. */
export function operatorsFor(type: string | undefined): ConditionOperator[] {
  if (type === FILE_TYPE) return ["answered"];
  if (type === "checkbox") return ["equals", "answered"];
  if (CHOICE_TYPES.has(type ?? "")) return ["equals", "not_equals", "one_of", "answered"];
  return ["equals", "not_equals", "contains", "answered", "one_of"];
}

function hasOption(field: LogicField, value: string): boolean {
  return (field.options ?? []).some((option) => norm(option) === norm(value));
}

function labelOf(field: LogicField): string {
  return field.label || field.key;
}

/**
 * Why a question list's conditions can't be saved, in words, or null.
 *
 * Every refusal here is a question that would otherwise never appear, or always
 * appear, without anybody being told: a rule naming a question below it, a
 * question that was deleted, or a choice that was renamed.
 */
export function logicProblem(fields: LogicField[]): string | null {
  const earlier = new Map<string, LogicField>();

  for (const field of fields) {
    const rule = field.showIf ?? null;
    if (rule) {
      const label = labelOf(field);
      if (IDENTITY_KEYS.has(field.key)) {
        return `“${label}” is always asked, so it can't be shown only sometimes.`;
      }
      if (!isOperator(rule.operator)) return `“${label}” has a show rule we don't recognise.`;
      if (rule.field === field.key) return `“${label}” can't depend on its own answer.`;

      const controller = earlier.get(rule.field);
      if (!controller) {
        const later = fields.find((other) => other.key === rule.field);
        return later
          ? `“${label}” depends on “${labelOf(later)}”, which comes after it. Move “${label}” below it, or change the rule.`
          : `“${label}” depends on a question that isn't on this form any more. Choose another question, or remove the rule.`;
      }

      const trigger = labelOf(controller);
      if (IDENTITY_KEYS.has(controller.key)) {
        return `“${label}” can't depend on the name or email address — choose another question.`;
      }
      if (controller.type === "hidden") {
        return `“${label}” can't depend on “${trigger}”, because nobody sees that question to answer it.`;
      }
      if (!operatorsFor(controller.type).includes(rule.operator)) {
        return `“${label}” uses a rule that doesn't work with “${trigger}”. Pick another one.`;
      }

      if (rule.operator === "equals" || rule.operator === "not_equals" || rule.operator === "contains") {
        const value = (rule.value ?? "").trim();
        if (!value) {
          return `“${label}” shows depending on “${trigger}”, but the answer to compare with is blank.`;
        }
        if (controller.type === "checkbox" && !["yes", "no"].includes(norm(value))) {
          return `“${label}” depends on whether “${trigger}” is ticked — choose ticked or not ticked.`;
        }
        if (CHOICE_TYPES.has(controller.type ?? "") && !hasOption(controller, value)) {
          return `“${label}” shows when “${trigger}” is “${value}”, but that isn't one of its choices any more.`;
        }
      }

      if (rule.operator === "one_of") {
        const values = (rule.values ?? []).map((entry) => entry.trim()).filter(Boolean);
        if (values.length === 0) {
          return `“${label}” shows when “${trigger}” is one of a list, but the list is empty.`;
        }
        if (CHOICE_TYPES.has(controller.type ?? "")) {
          const missing = values.find((entry) => !hasOption(controller, entry));
          if (missing) {
            return `“${label}” shows when “${trigger}” is “${missing}”, but that isn't one of its choices any more.`;
          }
        }
      }
    }
    earlier.set(field.key, field);
  }
  return null;
}

/** The ready-made format rules the builder offers, said the way it says them. */
const PATTERN_WORDS: Record<string, string> = {
  "^[0-9]+$": "can only contain numbers",
  "^[A-Za-z' -]+$": "can only contain letters",
  "^[0-9]{5}$": "needs to be a five-digit ZIP code",
};

/**
 * The first reason these answers can't be accepted, or null.
 *
 * Only questions that were shown are checked. `filesPresent` names the file
 * questions a file really arrived for — never what the client said about them.
 * The name and email address are left to the route, which has always owned
 * those two.
 */
export function answerProblem(
  fields: unknown,
  data: Record<string, unknown>,
  visible: Set<string>,
  filesPresent: Set<string>,
): string | null {
  for (const field of asFields(fields)) {
    if (!visible.has(field.key) || IDENTITY_KEYS.has(field.key) || field.type === "hidden") continue;
    const label = labelOf(field);

    if (field.type === FILE_TYPE) {
      if (field.required && !filesPresent.has(field.key)) return `Please attach a file for “${label}”.`;
      continue;
    }

    const answer = data[field.key];
    if (field.required && !isAnswered(field, answer)) {
      return `Please answer “${label}” — it's required.`;
    }
    if (typeof answer !== "string") continue;
    const text = answer.trim();
    if (!text) continue;

    if (text.length > MAX_ANSWER_CHARS) return `The answer to “${label}” is too long.`;
    if (typeof field.minLength === "number" && text.length < field.minLength) {
      return `“${label}” needs at least ${field.minLength} characters.`;
    }
    if (typeof field.maxLength === "number" && text.length > field.maxLength) {
      return `“${label}” can be at most ${field.maxLength} characters.`;
    }
    if (field.pattern) {
      let rule: RegExp;
      try {
        rule = new RegExp(field.pattern);
      } catch {
        // The builder refuses a broken rule; an old row with one is not the
        // visitor's fault, so it is skipped rather than failing every reply.
        continue;
      }
      if (!rule.test(text)) {
        return `“${label}” ${PATTERN_WORDS[field.pattern] ?? "isn't in the format it asks for"}.`;
      }
    }
  }
  return null;
}

/**
 * The answers worth storing: nothing for a hidden question, and nothing a
 * client typed in under a file question (the route fills those in from the
 * files that actually arrived). Keys the form doesn't list are left as they
 * were, as they always have been.
 */
export function keptAnswers(
  fields: unknown,
  data: Record<string, unknown>,
  visible: Set<string>,
): Record<string, unknown> {
  const kept: Record<string, unknown> = { ...data };
  for (const field of asFields(fields)) {
    if (IDENTITY_KEYS.has(field.key)) continue;
    if (field.type === FILE_TYPE || !visible.has(field.key)) delete kept[field.key];
  }
  return kept;
}
