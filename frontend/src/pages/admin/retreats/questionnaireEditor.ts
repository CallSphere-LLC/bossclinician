import {
  CHOICE_TYPES,
  type QuestionDefinition,
  type QuestionnaireDefinition,
  type QuestionType,
  type SectionDefinition,
} from "@/lib/retreatsApi";

/**
 * Pure rules behind the questionnaire editor, kept apart from the JSX so they
 * can be tested without a DOM. The server checks every one of them again
 * (services/retreatQuestionnaires.ts parseDefinition); these only stop the
 * owner pressing Save on something that would be refused.
 */

/** Every question and section id in a definition. */
export function usedIds(definition: QuestionnaireDefinition): Set<string> {
  const ids = new Set<string>();
  for (const section of definition.sections) {
    ids.add(section.id);
    for (const q of section.questions) ids.add(q.id);
  }
  return ids;
}

/**
 * A new id that is not in `taken`. Random rather than counted, so an id freed
 * by removing a question is never handed to a different question later (old
 * answers are keyed by id and keep their own wording).
 */
export function newId(prefix: "q" | "s", taken: Set<string>, random: () => number = Math.random): string {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const id = `${prefix}_${Math.floor(random() * 36 ** 8).toString(36).padStart(6, "0")}`;
    if (!taken.has(id)) return id;
  }
  throw new Error("Could not make a unique id");
}

/** Moves item `from` by `delta` places; out-of-range moves return the same order (a copy). */
export function moveItem<T>(items: T[], from: number, delta: number): T[] {
  const to = from + delta;
  const copy = [...items];
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export function isChoice(type: QuestionType): boolean {
  return CHOICE_TYPES.includes(type);
}

export function blankQuestion(taken: Set<string>): QuestionDefinition {
  return {
    id: newId("q", taken),
    type: "short_text",
    label: "",
    help: "",
    required: false,
    options: [],
    showTo: "all",
    showIf: null,
    sensitive: false,
  };
}

export function blankSection(taken: Set<string>): SectionDefinition {
  return { id: newId("s", taken), title: "", description: "", questions: [] };
}

/** "One per line" textarea ↔ options list (blank lines and repeats dropped). */
export function parseOptions(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const value = line.trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

/** Questions another question may depend on ("show only if"): any other question (a file question counts as "has an upload"). */
export function conditionTargets(definition: QuestionnaireDefinition, questionId: string): QuestionDefinition[] {
  return definition.sections.flatMap((s) => s.questions).filter((q) => q.id !== questionId);
}

/**
 * Cleans a definition before saving: options only on choice types, and a
 * condition dropped when the question it pointed at is gone, or when it named
 * answers that question no longer offers.
 */
export function tidyDefinition(definition: QuestionnaireDefinition): QuestionnaireDefinition {
  const all = new Map(definition.sections.flatMap((s) => s.questions).map((q) => [q.id, q]));
  return {
    intro: definition.intro,
    sections: definition.sections.map((section) => ({
      ...section,
      questions: section.questions.map((q) => {
        const options = isChoice(q.type) ? q.options : [];
        let showIf = q.showIf;
        if (showIf) {
          const target = all.get(showIf.questionId);
          if (!target || target.id === q.id) showIf = null;
          else if (isChoice(target.type)) {
            const anyOf = showIf.anyOf.filter((v) => target.options.includes(v));
            showIf = { questionId: target.id, anyOf };
          } else showIf = { questionId: target.id, anyOf: [] };
        }
        return { ...q, options, showIf };
      }),
    })),
  };
}

/** Plain-language problems that would stop a save (empty = fine). */
export function validateDefinition(definition: QuestionnaireDefinition): string[] {
  const problems: string[] = [];
  if (definition.sections.length === 0) problems.push("Add at least one section.");
  const seen = new Set<string>();
  let index = 0;
  for (const section of definition.sections) {
    if (seen.has(section.id)) problems.push(`Two sections share the id "${section.id}".`);
    seen.add(section.id);
    for (const q of section.questions) {
      index += 1;
      const name = q.label.trim() ? `“${q.label.trim().slice(0, 60)}”` : `Question ${index}`;
      if (seen.has(q.id)) problems.push(`${name} shares its id with another item.`);
      seen.add(q.id);
      if (!q.label.trim()) problems.push(`${name} needs its wording.`);
      if (isChoice(q.type) && q.options.length === 0) problems.push(`${name} needs at least one option.`);
      if (q.showIf) {
        const target = definition.sections.flatMap((s) => s.questions).find((t) => t.id === q.showIf!.questionId);
        if (!target || target.id === q.id) problems.push(`${name} depends on a question that isn't in this questionnaire.`);
        else if (isChoice(target.type) && q.showIf.anyOf.some((v) => !target.options.includes(v))) {
          problems.push(`${name} depends on an answer that “${target.label}” no longer offers.`);
        }
      }
    }
  }
  if (index > 200) problems.push("A questionnaire can have up to 200 questions.");
  return problems;
}

export function sameDefinition(a: QuestionnaireDefinition, b: QuestionnaireDefinition): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
