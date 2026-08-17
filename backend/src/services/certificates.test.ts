import { describe, expect, it } from "vitest";
import { formatCreditHours, normalizeVerificationCode, renderCertificatePdf } from "./certificates";

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
