import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import HireForm from "./HireForm";
import HiringQuiz from "./HiringQuiz";
import {
  HIRE_FORM,
  HIRING_QUIZ_QUESTIONS,
  HIRING_QUIZ_RESULTS,
  emptyHiringProgress,
  restoreHiringProgress,
} from "@/content/hiringQuiz";
import { SsrProvider } from "@/ssr/context";

/**
 * Q17 (30 Oct 2026): questions, then name and email, then the result. Rendered in
 * Node with no `window`, as the server renders it.
 */
function render(location: string, page: ReactElement): string {
  return renderToString(
    <SsrProvider runtime={{ payload: { origin: "https://example.com", indexable: true, data: {} }, headSink: [] }}>
      <StaticRouter location={location}>{page}</StaticRouter>
    </SsrProvider>,
  );
}

/** React escapes apostrophes and quotes in text; compare against the same. */
function escaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
}

const allAnswered = HIRING_QUIZ_QUESTIONS.map(() => 0);
const stored = (progress: Partial<ReturnType<typeof emptyHiringProgress>>) =>
  JSON.stringify({ ...emptyHiringProgress(), ...progress });

const addresses: [string, ReactElement][] = [
  ["/hiring-quiz", <HiringQuiz key="quiz" />],
  ["/hire-form", <HireForm key="form" />],
];

describe.each(addresses)("%s as first served", (location, page) => {
  const html = render(location, page);

  it("opens on the first question, not the opt-in", () => {
    expect(html).toContain(escaped(HIRING_QUIZ_QUESTIONS[0].text.slice(0, 20)));
    expect(html).not.toContain(escaped(HIRE_FORM.lead));
    expect(html).not.toContain(escaped(HIRE_FORM.submit));
    expect(html).not.toContain('name="email"');
  });

  it("has nothing of any result in it", () => {
    for (const result of Object.values(HIRING_QUIZ_RESULTS)) {
      expect(html).not.toContain(escaped(result.headline));
      expect(html).not.toContain(escaped(result.sub));
      expect(html).not.toContain(escaped(result.p1));
      expect(html).not.toContain(escaped(result.eyebrow));
    }
    expect(html).not.toMatch(/bg-green|bg-plum-bright/);
  });
});

describe("restoreHiringProgress", () => {
  it("starts over on nothing stored, or anything unreadable", () => {
    const empty = emptyHiringProgress();
    expect(restoreHiringProgress(null, false)).toEqual(empty);
    expect(restoreHiringProgress("not json", false)).toEqual(empty);
    expect(restoreHiringProgress("null", false)).toEqual(empty);
    expect(restoreHiringProgress(stored({ picks: [0] }), false)).toEqual(empty);
    expect(restoreHiringProgress(stored({ index: 99 }), false)).toEqual(empty);
    expect(restoreHiringProgress(stored({ picks: allAnswered.map(() => 99) }), false)).toEqual(empty);
  });

  it("keeps the answers and the question reached", () => {
    const picks = emptyHiringProgress().picks;
    picks[0] = 1;
    const back = restoreHiringProgress(stored({ index: 1, picks }), false);
    expect(back).toMatchObject({ index: 1, picks, optIn: false, revealed: false });
  });

  it("returns finished answers to the opt-in", () => {
    expect(restoreHiringProgress(stored({ picks: allAnswered, optIn: true }), false)).toMatchObject({ optIn: true, revealed: false });
  });

  it("never returns a result to someone who has not opted in", () => {
    const back = restoreHiringProgress(stored({ picks: allAnswered, revealed: true, filed: true }), false);
    expect(back).toMatchObject({ optIn: true, revealed: false, filed: false });
  });

  it("never returns a result for unfinished answers", () => {
    const back = restoreHiringProgress(stored({ revealed: true, filed: true }), true);
    expect(back).toMatchObject({ optIn: false, revealed: false, filed: false });
  });

  it("returns the result to someone who opted in, remembering it was filed", () => {
    expect(restoreHiringProgress(stored({ picks: allAnswered, revealed: true, filed: true }), true)).toMatchObject({ revealed: true, filed: true });
    expect(restoreHiringProgress(stored({ picks: allAnswered, revealed: true }), true)).toMatchObject({ revealed: true, filed: false });
  });
});
