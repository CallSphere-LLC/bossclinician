import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { IncomeStreamAssessment } from "./IncomeStreamAssessment";
import { readFileSync } from "node:fs";
import {
  INCOME_INTRO,
  INCOME_QUESTIONS,
  INCOME_RESULTS,
  INCOME_RESULT_NOTE,
  INCOME_STREAM_KEY,
  assessmentReducer,
  assessmentResult,
  initialAssessment,
  scoreIncomeStream,
  type AssessmentState,
  type Choice,
} from "./incomeStream";

const A = 0, B = 1, C = 2;
const title = (answers: Choice[]) => INCOME_RESULTS[scoreIncomeStream(answers)].title;

describe("income stream scoring (README QA cases)", () => {
  it("A majority is Optimize First", () => expect(title([A, A, A, B, C])).toBe("Optimize First"));
  it("B majority is One Strategic Add", () => expect(title([B, B, B, A, C])).toBe("One Strategic Add"));
  it("C majority is Ready to Expand", () => expect(title([C, C, C, A, B])).toBe("Ready to Expand"));
  it("A/B tie is Optimize First", () => expect(title([A, B, A, B, C])).toBe("Optimize First"));
  it("A/C tie is Optimize First", () => expect(title([C, A, C, A, B])).toBe("Optimize First"));
  it("B/C tie is One Strategic Add", () => expect(title([C, B, C, B, A])).toBe("One Strategic Add"));
  it("tie order does not depend on answer order", () => {
    expect(title([C, C, B, B, A])).toBe("One Strategic Add");
    expect(title([B, B, A, A, C])).toBe("Optimize First");
  });
});

function walk(choices: Choice[]): AssessmentState {
  let s = assessmentReducer(initialAssessment, { type: "start" });
  for (const choice of choices) {
    s = assessmentReducer(s, { type: "choose", choice });
    s = assessmentReducer(s, { type: "next" });
  }
  return s;
}

describe("assessment flow", () => {
  it("will not continue without an answer", () => {
    const s = assessmentReducer(initialAssessment, { type: "start" });
    expect(assessmentReducer(s, { type: "next" }).stage).toBe(0);
  });
  it("shows the result right after the fifth answer", () => {
    const s = walk([C, C, C, C, C]);
    expect(s.stage).toBe(5);
    expect(assessmentResult(s)?.title).toBe("Ready to Expand");
  });
  it("Back keeps earlier answers and returns to the introduction from question 1", () => {
    let s = walk([B, A]);
    s = assessmentReducer(s, { type: "back" });
    expect(s.stage).toBe(1);
    expect(s.answers[1]).toBe(A);
    s = assessmentReducer(assessmentReducer(s, { type: "back" }), { type: "back" });
    expect(s.stage).toBe(-1);
    expect(s.answers.slice(0, 2)).toEqual([B, A]);
  });
  it("Retake clears every answer", () => {
    expect(assessmentReducer(walk([A, A, A, A, A]), { type: "retake" })).toEqual(initialAssessment);
  });
});

function render(state: AssessmentState = initialAssessment, path = "/library/the-practice-elevation/lessons/do-you-actually-need-this-income-stream-decision-assessment") {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/library/:productSlug/lessons/:lessonSlug" element={<IncomeStreamAssessment initialState={state} />} />
      </Routes>
    </MemoryRouter>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

describe("rendering", () => {
  it("is registered under the key migration 200 sets", () => {
    expect(INCOME_STREAM_KEY).toBe("income-stream-assessment");
    // Read rather than imported: the registry pulls in every other tool.
    const registry = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
    expect(registry).toContain("[INCOME_STREAM_KEY]: IncomeStreamAssessment");
  });

  it("opens on the introduction with her copy and no question yet", () => {
    const html = render();
    expect(html).toContain(INCOME_INTRO.title);
    expect(html).toContain(INCOME_INTRO.lead);
    expect(html).toContain(INCOME_INTRO.heading);
    expect(html).toContain(INCOME_INTRO.body);
    expect(html).toContain(INCOME_INTRO.note);
    expect(html).toContain("Start the Assessment");
    expect(html).not.toContain(INCOME_QUESTIONS[0].question);
  });

  it("shows exactly one question with its three choices in source order and no letters", () => {
    const html = render({ stage: 2, answers: [A, B, null, null, null] });
    const q = INCOME_QUESTIONS[2];
    expect(html).toContain("Question 3 of 5");
    expect(html).toContain(q.question);
    INCOME_QUESTIONS.filter((_, i) => i !== 2).forEach((other) => expect(html).not.toContain(other.question));
    const positions = q.options.map((o) => html.indexOf(o));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(text(html)).not.toMatch(/\b[ABC][.)]\s/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue/);
    expect(html.match(/<input/g)).toHaveLength(3);
    expect(html).not.toMatch(/<textarea/);
  });

  it("says See My Result on the last question once answered", () => {
    const html = render({ stage: 4, answers: [A, A, A, A, B] });
    expect(html).toContain("Question 5 of 5");
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>See My Result/);
  });

  it("renders the full result, Retake and a same-course Back to Module 02 link", () => {
    const html = render({ stage: 5, answers: [B, C, B, C, A] });
    const r = INCOME_RESULTS[1];
    expect(html).toContain(r.title);
    expect(html).toContain(r.headline);
    expect(html).toContain(r.body);
    r.steps.forEach((s) => expect(html).toContain(s));
    expect(html).toContain(INCOME_RESULT_NOTE.body);
    expect(html).toContain("Retake Assessment");
    expect(html).toContain('href="/library/the-practice-elevation/lessons/welcome-to-module-2"');
  });

  it("keeps Board Room members inside The Board Room", () => {
    const html = render({ stage: 5, answers: [A, A, A, A, A] }, "/library/the-board-room/lessons/do-you-actually-need-this-income-stream-decision-assessment");
    expect(html).toContain('href="/library/the-board-room/lessons/welcome-to-module-2"');
  });

  it("renders no em dashes or emoji in any screen", () => {
    const screens: AssessmentState[] = [
      initialAssessment,
      ...INCOME_QUESTIONS.map((_, i) => ({ stage: i, answers: initialAssessment.answers })),
      ...[0, 1, 2].map((c) => ({ stage: 5, answers: Array(5).fill(c) as Choice[] })),
    ];
    for (const s of screens) {
      const t = text(render(s));
      expect(t).not.toMatch(/—/);
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
