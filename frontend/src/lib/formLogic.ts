/**
 * Conditional questions and answer rules, as the public form page and the
 * builder see them.
 *
 * A mirror of backend/src/services/formLogic.ts, which makes the real decision
 * when a reply arrives. They must agree: a page that shows a question the server
 * then treats as hidden throws the visitor's answer away. Both have tests over
 * the same cases (formLogic.test.ts on each side).
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
  field: string;
  operator: ConditionOperator;
  value?: string;
  values?: string[];
}

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

const IDENTITY_KEYS = new Set(["name", "email"]);
const CHOICE_TYPES = new Set(["select", "radio", "checkboxes"]);

export const MAX_ANSWER_CHARS = 10_000;

export function isIdentityKey(key: string): boolean {
  return IDENTITY_KEYS.has(key);
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function isOperator(value: unknown): value is ConditionOperator {
  return typeof value === "string" && (CONDITION_OPERATORS as readonly string[]).includes(value);
}

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

/** The questions somebody with these answers is shown. See the backend twin. */
export function visibleQuestionKeys(
  fields: readonly LogicField[],
  data: Record<string, unknown>,
): Set<string> {
  const earlier = new Map<string, LogicField>();
  const visible = new Set<string>();
  for (const field of fields) {
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

export function operatorsFor(type: string | undefined): ConditionOperator[] {
  if (type === FILE_TYPE) return ["answered"];
  if (type === "checkbox") return ["equals", "answered"];
  if (CHOICE_TYPES.has(type ?? "")) return ["equals", "not_equals", "one_of", "answered"];
  return ["equals", "not_equals", "contains", "answered", "one_of"];
}

/** Whether a question can be the thing another question depends on. */
export function canTrigger(field: LogicField): boolean {
  return !IDENTITY_KEYS.has(field.key) && field.type !== "hidden";
}

function hasOption(field: LogicField, value: string): boolean {
  return (field.options ?? []).some((option) => norm(option) === norm(value));
}

function labelOf(field: LogicField): string {
  return field.label || field.key;
}

/** Why the conditions on these questions can't be saved, or null. Same wording as the server. */
export function logicProblem(fields: readonly LogicField[]): string | null {
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

const PATTERN_WORDS: Record<string, string> = {
  "^[0-9]+$": "can only contain numbers",
  "^[A-Za-z' -]+$": "can only contain letters",
  "^[0-9]{5}$": "needs to be a five-digit ZIP code",
};

/**
 * The first rule a shown, answered question breaks, or null. Required-ness is
 * left to the page's own star message; this is the "More rules" half.
 */
export function ruleProblem(field: LogicField, answer: unknown): string | null {
  if (typeof answer !== "string") return null;
  const text = answer.trim();
  if (!text) return null;
  const label = labelOf(field);
  if (text.length > MAX_ANSWER_CHARS) return `The answer to “${label}” is too long.`;
  if (typeof field.minLength === "number" && text.length < field.minLength) {
    return `“${label}” needs at least ${field.minLength} characters.`;
  }
  if (typeof field.maxLength === "number" && text.length > field.maxLength) {
    return `“${label}” can be at most ${field.maxLength} characters.`;
  }
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(text)) {
        return `“${label}” ${PATTERN_WORDS[field.pattern] ?? "isn't in the format it asks for"}.`;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/* ── File questions ─────────────────────────────────────────────────────── */

export const FILE_CATEGORIES = ["image", "pdf", "word", "spreadsheet"] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

/** Must match FORM_UPLOAD_HARD_CAP_MB in backend/src/services/formUploads.ts. */
export const FORM_UPLOAD_HARD_CAP_MB = 10;
export const MAX_FILE_QUESTIONS = 5;
export const DEFAULT_FILE_CATEGORIES: FileCategory[] = ["image", "pdf"];
export const DEFAULT_MAX_SIZE_MB = 5;

export const FILE_CATEGORY_LABEL: Record<FileCategory, string> = {
  image: "Photos (JPEG, PNG, GIF, WebP)",
  pdf: "PDFs",
  word: "Word documents (.docx)",
  spreadsheet: "Spreadsheets (.xlsx)",
};

const CATEGORY_ACCEPT: Record<FileCategory, string[]> = {
  image: [".jpg", ".jpeg", ".png", ".gif", ".webp", "image/jpeg", "image/png", "image/gif", "image/webp"],
  pdf: [".pdf", "application/pdf"],
  word: [".docx"],
  spreadsheet: [".xlsx"],
};

const CATEGORY_EXTENSIONS: Record<FileCategory, string[]> = {
  image: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
  pdf: [".pdf"],
  word: [".docx"],
  spreadsheet: [".xlsx"],
};

export function fileCategoriesOf(field: { fileTypes?: unknown }): FileCategory[] {
  const chosen = Array.isArray(field.fileTypes)
    ? field.fileTypes.filter((entry): entry is FileCategory =>
        (FILE_CATEGORIES as readonly string[]).includes(String(entry)),
      )
    : [];
  return chosen.length > 0 ? chosen : DEFAULT_FILE_CATEGORIES;
}

export function maxSizeMbOf(field: { maxSizeMb?: unknown }): number {
  const mb = typeof field.maxSizeMb === "number" && field.maxSizeMb > 0 ? field.maxSizeMb : DEFAULT_MAX_SIZE_MB;
  return Math.min(mb, FORM_UPLOAD_HARD_CAP_MB);
}

/** The `accept` attribute for a file input. A hint to the picker, not a check. */
export function acceptAttribute(field: { fileTypes?: unknown }): string {
  return fileCategoriesOf(field)
    .flatMap((category) => CATEGORY_ACCEPT[category])
    .join(",");
}

/**
 * A friendly early refusal, before a slow upload. The server checks the bytes
 * themselves and has the final say; this only reads the name and size.
 */
export function fileProblem(
  field: { label?: string; key: string; fileTypes?: unknown; maxSizeMb?: unknown },
  file: { name: string; size: number },
): string | null {
  const label = field.label || field.key;
  const categories = fileCategoriesOf(field);
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!categories.some((category) => CATEGORY_EXTENSIONS[category].includes(extension))) {
    const words = categories.map((category) => FILE_CATEGORY_LABEL[category]).join(", ");
    return `“${label}” takes ${words}. That file isn't one.`;
  }
  if (file.size === 0) return `The file for “${label}” is empty.`;
  const mb = maxSizeMbOf(field);
  if (file.size > mb * 1024 * 1024) return `“${label}” takes files up to ${mb} MB. That one is bigger.`;
  return null;
}
