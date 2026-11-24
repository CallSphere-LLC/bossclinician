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
    const email = bossAssessmentEmail({ firstName: read.firstName, result: read.result, siteUrl: "https://site.test" });
    if (!email) throw new Error("expected an email");
    return email;
  };

  it("is the A0 email: subject, preview, total, five scores and the highest area", () => {
    const { subject, preheader, text, html } = render();
    expect(subject).toBe("Your practice assessment results + where to start");
    expect(preheader).toBe("One area to look at first, without adding five projects to your week.");
    expect(text.startsWith("Hey!")).toBe(true);
    for (const body of [text, html]) {
      expect(body).toContain("30 / 50");
      expect(body).toContain("Leadership Dependency");
      expect(body).toContain("10 / 10");
      expect(body).toContain("Your highest-scoring area or areas: Leadership Dependency.");
      expect(body).toContain("You may be the person everyone checks with");
      expect(body).toContain("Hit reply and tell me.");
      expect(body).not.toContain("Some of the practice may still run on information only you know.");
      expect(body).not.toContain("—");
    }
  });

  it("uses the standard frame without adding promotional buttons or links", () => {
    const { text, html } = render();
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["https://site.test", "https://site.test"]);
    expect(text).not.toMatch(/https?:\/\//);
    expect(html).toContain('max-width:600px');
    expect(html).toContain('font-size:16px');
    expect(html).toContain('aria-label="Assessment area scores"');
    expect(html.match(/data-bc-shell="1"/g)).toHaveLength(1);
    expect(html).toContain("You requested your practice assessment results from");
  });

  it("includes every tied highest block", () => {
    const read = submission();
    const result = scoreBossAssessment([5, 5, 1, 1, 5, 5, 1, 1, 1, 1]);
    const email = bossAssessmentEmail({ firstName: read.firstName, result, siteUrl: "https://site.test" });
    expect(email?.text).toContain("Leadership Dependency and Missing Systems.");
    expect(email?.text).toContain("You may be the person everyone checks with");
    expect(email?.text).toContain("Some of the practice may still run on information only you know.");
  });

  it("holds an incomplete result instead of mailing invented numbers", () => {
    const read = submission();
    const broken = { ...read.result, totals: [10, 6] };
    expect(bossAssessmentEmail({ firstName: read.firstName, result: broken, siteUrl: "https://site.test" })).toBeNull();
  });

  it("never mails the commitment box, the name or anything else the client wrote", () => {
    const { subject, text, html } = render({
      first_name: "Free Money Now",
      commitment: "CLICK https://evil.example FOR FREE MONEY",
      tier: "CLICK https://evil.example",
    });
    const all = `${subject}
${text}
${html}`;
    expect(all).not.toContain("evil.example");
    expect(all).not.toContain("FREE MONEY");
    expect(all).not.toContain("Money");
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
