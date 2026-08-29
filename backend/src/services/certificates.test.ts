import { describe, expect, it } from "vitest";
import {
  earnedCeuCredit,
  formatCreditHours,
  normalizeVerificationCode,
  renderCertificatePdf,
  requiredDwellSeconds,
  type CeuLessonRecord,
} from "./certificates";

/**
 * The credit figure is the compliance-critical part of a certificate: a board
 * reads it, and a course approved for 1.5 hours that prints "2" is a problem the
 * therapist discovers at renewal. It is tested here to the quarter-hour.
 */

describe("formatCreditHours", () => {
  it("renders quarter-hours exactly", () => {
    expect(formatCreditHours(6)).toBe("1.5 CE hours");
    expect(formatCreditHours(1)).toBe("0.25 CE hours");
    expect(formatCreditHours(3)).toBe("0.75 CE hours");
    expect(formatCreditHours(7)).toBe("1.75 CE hours");
    expect(formatCreditHours(8)).toBe("2 CE hours");
    expect(formatCreditHours(40)).toBe("10 CE hours");
    expect(formatCreditHours(41)).toBe("10.25 CE hours");
  });

  it("says hour, singular, at exactly one", () => {
    expect(formatCreditHours(4)).toBe("1 CE hour");
  });

  it("says nothing at all for a course with no CE credit", () => {
    expect(formatCreditHours(0)).toBe("");
    expect(formatCreditHours(-4)).toBe("");
    expect(formatCreditHours(Number.NaN)).toBe("");
  });
});

describe("normalizeVerificationCode", () => {
  const canonical = "BC-4KQ2-9XJH-7M3T-P8ZR";

  it("accepts the canonical form", () => {
    expect(normalizeVerificationCode(canonical)).toBe(canonical);
  });

  it("accepts what somebody actually types off a printed page", () => {
    expect(normalizeVerificationCode("bc4kq29xjh7m3tp8zr")).toBe(canonical);
    expect(normalizeVerificationCode(" BC 4KQ2 9XJH 7M3T P8ZR ")).toBe(canonical);
    expect(normalizeVerificationCode("4KQ2-9XJH-7M3T-P8ZR")).toBe(canonical);
  });

  it("maps the characters the alphabet leaves out to what was meant", () => {
    // O, I and L are not in the alphabet, so a code containing them was misread.
    expect(normalizeVerificationCode("BC-4KQ2-9XJH-7M3T-P8ZR".replace("0", "O"))).toBe(canonical);
    expect(normalizeVerificationCode("BC-4KQ2-9XJH-7M3T-P8ZR".replace("1", "I"))).toBe(canonical);
  });

  it("reads a body that happens to begin BC as a body, not a prefix", () => {
    // One code in a thousand starts with the two letters the prefix uses. Typed
    // back without its prefix, a genuine certificate must still verify rather
    // than getting the answer a forgery gets.
    const bodyStartsWithBc = "BC-BCQ2-9XJH-7M3T-P8ZR";
    expect(normalizeVerificationCode(bodyStartsWithBc)).toBe(bodyStartsWithBc);
    expect(normalizeVerificationCode("BCQ29XJH7M3TP8ZR")).toBe(bodyStartsWithBc);
    expect(normalizeVerificationCode("BCQ2-9XJH-7M3T-P8ZR")).toBe(bodyStartsWithBc);
  });

  it("refuses anything that could not be a code", () => {
    expect(normalizeVerificationCode("")).toBeNull();
    expect(normalizeVerificationCode("BC-4KQ2")).toBeNull();
    expect(normalizeVerificationCode(`${canonical}EXTRA`)).toBeNull();
    expect(normalizeVerificationCode("' OR 1=1 --")).toBeNull();
  });
});

describe("renderCertificatePdf", () => {
  it("fits on one page with the longest content it accepts", async () => {
    const pdf = await renderCertificatePdf({
      recipientName: "Dr. Alexandra Constantinopoulos-Fitzwilliam, LCSW, LMFT",
      courseTitle:
        "Ethics, Boundaries and Risk Management for the Independently Licensed Clinician in Private Practice",
      completedAt: new Date("2026-03-03T12:00:00Z"),
      verificationCode: "BC-4KQ2-9XJH-7M3T-P8ZR",
      creditQuarterHours: 6,
      providerNumber: "SW-1234-ACE",
      artwork: {
        title: "Certificate of Completion",
        body: "This programme was approved for continuing education credit for licensed clinical social workers, marriage and family therapists and professional counsellors.",
        signatureName: "Yvette Howard, LCSW",
        signatureTitle: "Founder, Boss Clinician",
        signatureImagePath: null,
        logoPath: null,
        providerName: "Boss Clinician CE",
      },
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // A certificate that spills onto a second page is one somebody prints and
    // files without the half carrying the credit hours.
    const pages = pdf.toString("latin1").match(/\/Type \/Page[^s]/g) ?? [];
    expect(pages).toHaveLength(1);
  });
});

/**
 * What a CE certificate costs, and what it still cannot stop.
 *
 * The document says a named therapist completed n hours of approved
 * instruction, and a licensing board acts on that sentence. A video lesson is
 * measured by the watch figure, which accrues no faster than the clock. A
 * lesson with nothing to play — a reading, a PDF, a worksheet — has only the
 * clock, so it is measured from the moment the lesson was opened to the moment
 * it was ticked.
 */

const AT = (iso: string): Date => new Date(iso);

function textLesson(over: Partial<CeuLessonRecord> = {}): CeuLessonRecord {
  return {
    contentType: "text",
    durationMinutes: 10,
    watchedPercent: 0,
    firstViewedAt: AT("2026-03-01T10:00:00Z"),
    completedAt: AT("2026-03-01T10:11:00Z"),
    ...over,
  };
}

describe("requiredDwellSeconds", () => {
  it("takes the author's own estimate, which is what the CE approval was written against", () => {
    expect(requiredDwellSeconds(10)).toBe(600);
    expect(requiredDwellSeconds(45)).toBe(2700);
  });

  it("holds a floor, so twenty one-line lessons still cost something", () => {
    expect(requiredDwellSeconds(0)).toBe(60);
    expect(requiredDwellSeconds(0.5)).toBe(60);
    expect(requiredDwellSeconds(-4)).toBe(60);
  });

  it("holds a ceiling, so a typo cannot make a certificate unobtainable", () => {
    expect(requiredDwellSeconds(600)).toBe(3600);
  });
});

describe("earnedCeuCredit", () => {
  it("refuses a text course finished in a burst of ticks", () => {
    // The whole defect: "mark complete" writes first_viewed_at and completed_at
    // in the same instant, so a script can walk a ten-lesson course in a second.
    const instant = AT("2026-03-01T10:00:00Z");
    const burst = Array.from({ length: 5 }, () =>
      textLesson({ firstViewedAt: instant, completedAt: instant })
    );
    expect(earnedCeuCredit(burst)).toBe(false);
  });

  it("accepts a text course read over the time it says it takes", () => {
    expect(earnedCeuCredit([textLesson(), textLesson()])).toBe(true);
  });

  it("refuses the one lesson that was rushed, however honest the rest", () => {
    expect(
      earnedCeuCredit([
        textLesson(),
        textLesson({ completedAt: AT("2026-03-01T10:02:00Z") }),
      ])
    ).toBe(false);
  });

  it("refuses a lesson that was never opened or never finished", () => {
    expect(earnedCeuCredit([textLesson({ firstViewedAt: null })])).toBe(false);
    expect(earnedCeuCredit([textLesson({ completedAt: null })])).toBe(false);
  });

  it("still ignores the tick on a lesson with something to sit through", () => {
    const watched = {
      contentType: "video",
      durationMinutes: 40,
      firstViewedAt: AT("2026-03-01T10:00:00Z"),
      completedAt: AT("2026-03-01T10:00:01Z"),
    };
    expect(earnedCeuCredit([{ ...watched, watchedPercent: 90 }])).toBe(true);
    expect(earnedCeuCredit([{ ...watched, watchedPercent: 89 }])).toBe(false);
    expect(earnedCeuCredit([{ ...watched, contentType: "audio", watchedPercent: 12 }])).toBe(false);
  });

  it("holds a mixed course to both rules at once", () => {
    expect(
      earnedCeuCredit([
        { ...textLesson(), contentType: "video", watchedPercent: 95 },
        textLesson({ contentType: "pdf" }),
      ])
    ).toBe(true);
  });

  it("holds a lesson that carries video to the watch figure, whatever the label says", () => {
    // Nothing in the admin writes `content_type`, so every lesson built through
    // the curriculum screen reads as 'text' however much video hangs off it.
    // Judging by the label alone let a CE course of forty-minute videos be
    // earned by opening each lesson, waiting, and ticking it — no playback.
    const labelledText = {
      contentType: "text",
      durationMinutes: 40,
      hasMedia: true,
      firstViewedAt: AT("2026-03-01T10:00:00Z"),
      completedAt: AT("2026-03-01T11:00:00Z"),
    };
    expect(earnedCeuCredit([{ ...labelledText, watchedPercent: 0 }])).toBe(false);
    expect(earnedCeuCredit([{ ...labelledText, watchedPercent: 90 }])).toBe(true);
  });

  it("leaves a lesson with nothing to play on the dwell rule", () => {
    expect(earnedCeuCredit([textLesson({ hasMedia: false })])).toBe(true);
  });

  it("treats a course with no published lessons as nothing to prove", () => {
    // The rollup cannot reach 100% on an empty course, so this is only ever
    // reached with lessons; vacuously true is the honest answer for the rule.
    expect(earnedCeuCredit([])).toBe(true);
  });
});
