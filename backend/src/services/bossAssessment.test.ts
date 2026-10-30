import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  BOSS_ASSESSMENT_AREAS,
  BOSS_ASSESSMENT_DISCLAIMER,
  bossAssessmentEmail,
  readBossAssessmentSubmission,
  scoreBossAssessment,
  type BossAssessmentSubmission,
} from "./bossAssessment";

const ANSWERS = [5, 5, 3, 2, 1, 1, 4, 4, 2, 3];

function submission(overrides: Record<string, unknown> = {}): BossAssessmentSubmission {
  const read = readBossAssessmentSubmission({
    first_name: "Yvette",
    email: "Reader@Example.com",
    answers: ANSWERS,
    ...overrides,
  });
  if ("problem" in read) throw new Error(read.problem);
  return read;
}

function problem(overrides: Record<string, unknown>): string | undefined {
  const read = readBossAssessmentSubmission({
    first_name: "Yvette",
    email: "reader@example.com",
    answers: ANSWERS,
    ...overrides,
  });
  return "problem" in read ? read.problem : undefined;
}

describe("scoreBossAssessment", () => {
  it("adds each area's two answers and the five areas", () => {
    const result = scoreBossAssessment(ANSWERS);
    expect(result.totals).toEqual([10, 5, 2, 8, 5]);
    expect(result.sum).toBe(30);
    expect(result.leaders).toEqual([0]);
  });

  it("changes tier at the source page's boundaries", () => {
    const summing = (sum: number) => {
      const answers = new Array<number>(10).fill(1);
      for (let left = sum - 10, i = 0; left > 0; i++) {
        const add = Math.min(4, left);
        answers[i] += add;
        left -= add;
      }
      return scoreBossAssessment(answers);
    };
    expect(summing(24).tierTitle).toBe("Focus on your highest blocker");
    expect(summing(25).tierTitle).toBe("Focus on your top priorities");
    expect(summing(39).tierTitle).toBe("Focus on your top priorities");
    expect(summing(40).tierTitle).toBe("Consider a structural reset");
  });

  it("shows ties together", () => {
    expect(scoreBossAssessment(new Array<number>(10).fill(3)).leaders).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("readBossAssessmentSubmission", () => {
  it("refuses anything but ten whole answers from 1 to 5", () => {
    expect(problem({ answers: ANSWERS.slice(0, 9) })).toBeTruthy();
    expect(problem({ answers: [...ANSWERS, 1] })).toBeTruthy();
    expect(problem({ answers: [6, ...ANSWERS.slice(1)] })).toBeTruthy();
    expect(problem({ answers: [0, ...ANSWERS.slice(1)] })).toBeTruthy();
    expect(problem({ answers: [1.5, ...ANSWERS.slice(1)] })).toBeTruthy();
    expect(problem({ answers: undefined })).toBeTruthy();
  });

  it("refuses more than one recipient", () => {
    expect(problem({ email: "a@example.com,b@example.com" })).toBeTruthy();
    expect(problem({ email: "a,b@example.com" })).toBeTruthy();
    expect(problem({ email: "a@example.com\nBcc: b@example.com" })).toBeTruthy();
  });

  it("refuses a first name that is carrying a message", () => {
    expect(problem({ first_name: "" })).toBeTruthy();
    expect(problem({ first_name: "evil.com" })).toBeTruthy();
    expect(problem({ first_name: "Visit https://evil.example now" })).toBeTruthy();
    expect(problem({ first_name: "<b>Hi</b>" })).toBeTruthy();
    expect(problem({ first_name: "Call 555 0100" })).toBeTruthy();
    expect(problem({ first_name: "x".repeat(41) })).toBeTruthy();
  });

  it("accepts the names people have", () => {
    for (const first_name of ["Yvette", "Mary Ann", "Anne-Marie", "O’Brien", "J.R.", "Zoë", "José"]) {
      expect(problem({ first_name })).toBeUndefined();
    }
  });

  it("rebuilds the reply from the answers, ignoring what the client says the result is", () => {
    const read = submission({ total: 50, tier: "You won", leadership_dependency: 99, extra: "spam" });
    expect(read.email).toBe("reader@example.com");
    expect(read.data.total).toBe(30);
    expect(read.data.tier).toBe("Focus on your top priorities");
    expect(read.data.leadership_dependency).toBe(10);
    expect(read.data.q10).toBe(3);
    expect(read.data).not.toHaveProperty("extra");
    expect(read.data).not.toHaveProperty("answers");
  });

  it("takes consent only from a real tick", () => {
    expect(submission().marketingConsent).toBe(false);
    expect(submission({ marketing_consent: true }).marketingConsent).toBe(true);
    expect(problem({ marketing_consent: "yes" })).toBeTruthy();
  });
});

describe("bossAssessmentEmail", () => {
  const render = (overrides: Record<string, unknown> = {}) => {
    const read = submission(overrides);
    return bossAssessmentEmail({ firstName: read.firstName, result: read.result, siteUrl: "https://site.test" });
  };

  it("carries the score, the result and the starting point", () => {
    const { text, html } = render();
    for (const body of [text, html]) {
      expect(body).toContain("30 / 50");
      expect(body).toContain("Focus on your top priorities");
      expect(body).toContain("Leadership Dependency");
      expect(body).toContain("10/10");
      expect(body).toContain("https://site.test/boardroom");
    }
  });

  it("never mails the commitment box or anything else the client wrote", () => {
    const { subject, text, html } = render({
      commitment: "CLICK https://evil.example FOR FREE MONEY",
      tier: "CLICK https://evil.example",
    });
    expect(`${subject}\n${text}\n${html}`).not.toContain("evil.example");
    expect(`${subject}\n${text}\n${html}`).not.toContain("FREE MONEY");
  });

  it("greets by the first word only and keeps the name out of the subject", () => {
    const { subject, text } = render({ first_name: "Free Money Now" });
    expect(text.startsWith("Hi Free,")).toBe(true);
    expect(text).not.toContain("Money");
    expect(subject).not.toContain("Free");
  });
});

describe("the page and the server say the same thing", () => {
  const page = resolve(__dirname, "../../../frontend/src/content/bossAssessment.ts");

  it.runIf(existsSync(page))("uses the same words as frontend/src/content/bossAssessment.ts", () => {
    const source = readFileSync(page, "utf8");
    const strings = [
      BOSS_ASSESSMENT_DISCLAIMER,
      ...BOSS_ASSESSMENT_AREAS.flatMap((area) => [area.title, area.description, area.action, ...area.questions]),
      ...[10, 30, 50].flatMap((sum) => {
        const each = Math.floor(sum / 10);
        const result = scoreBossAssessment(new Array<number>(10).fill(each));
        return [result.tierTitle, result.tierText];
      }),
    ];
    for (const text of strings) expect(source).toContain(text);
  });
});
