import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { buildMergeValues } from "../email/mergeValues";
import {
  mergeLinks,
  preheaderHtml,
  renderMarkdown,
  renderTokens,
  verifyPreferencesToken,
} from "../email/provider";
import { ALUMNI_EMAILS } from "./retreatAlumniEmails";
import { unsendableReason } from "./emailSendGuard";
import {
  anchoredSendAt,
  missingRetreatTokens,
  parseRetreatSkipRules,
  retreatMergeValues,
  retreatSkipReason,
  type RetreatGuestFacts,
} from "./retreatAnchor";

/**
 * The four post-retreat alumni emails after Yvette's round-2 answers (22 Nov
 * 2026, item 6; migration 225): exactly what a guest receives, rendered by the
 * real sending-path renderer, with nothing left over from the preview — no
 * {{tokens}}, no sample name, no "first access", no mis-encoded "?" where an
 * em dash belongs — and the skip rules and Day +3/+7/+14/+21 timing she approved.
 */

const SITE = "https://www.bossclinician.com";
const BALI = { siteUrl: SITE, slug: "bali-2027", title: "FlourisHealer Bali 2027", nextUrl: "" };

function render(position: number, firstName: string, retreat = BALI, contactId = 4242) {
  const e = ALUMNI_EMAILS[position - 1];
  const values = {
    ...buildMergeValues({ email: "alex@example.com", firstName }, mergeLinks(contactId)),
    ...retreatMergeValues(retreat),
  };
  const subject = renderTokens(e.subject, values);
  const preview = renderTokens(e.previewText, values);
  const text = renderTokens(e.bodyMd, values);
  const html = preheaderHtml(preview) + renderMarkdown(text);
  return { e, values, subject, preview, text, html };
}

/** Every character outside plain ASCII in a string. */
const nonAscii = (s: string) => [...s].filter((ch) => ch.charCodeAt(0) > 0x7e);

describe("alumni emails: what the guest receives", () => {
  for (const e of ALUMNI_EMAILS) {
    it(`Email ${e.position} renders with no placeholders, no sample name and no "first access"`, () => {
      const r = render(e.position, "Alex");
      for (const part of [r.subject, r.preview, r.text, r.html]) {
        expect(part).not.toMatch(/\{\{|\}\}/);
        expect(part).not.toMatch(/Jasmine/i);
        expect(part).not.toMatch(/first[- ]access/i);
        expect(part).not.toMatch(/preview|\[First Name\]/i);
      }
      expect(r.text.startsWith("Hey Alex,")).toBe(true);
      expect(missingRetreatTokens([e.subject, e.previewText, e.bodyMd], r.values)).toEqual([]);
      // The engine's own pre-send guard (placeholders, team/preview notes) passes it.
      expect(unsendableReason([e.subject, e.previewText, e.bodyMd], r.values, [r.subject, r.preview, r.text])).toBe("");
    });

    it(`Email ${e.position} greets a guest with no first name as "there"`, () => {
      expect(render(e.position, "").text.startsWith("Hey there,")).toBe(true);
    });

    it(`Email ${e.position} has no '?' artefacts: every em dash survives and no '?' joins two words`, () => {
      const r = render(e.position, "Alex");
      // The only question marks are Yvette's own questions.
      const sourceMarks = (e.subject + e.bodyMd + e.previewText).split("?").length;
      expect((r.subject + r.text + r.preview).split("?").length).toBe(sourceMarks);
      for (const part of [r.subject, r.preview, r.text, r.html]) {
        expect(part).not.toMatch(/[A-Za-z]\?[A-Za-z]/);
        expect(part).not.toContain("�");
      }
      // Each non-ASCII character in the copy (her em dashes) reaches the email intact.
      for (const ch of nonAscii(e.bodyMd)) {
        expect(ch).toBe("—");
        expect(r.text).toContain(ch);
        expect(r.html).toContain(ch);
      }
    });
  }

  it("links Emails 1-3 to the guest's own pages for THAT retreat, and Email 4 to /upcoming-retreats", () => {
    const button = (html: string) => /<a href="([^"]+)"[^>]*display:inline-block/.exec(html)?.[1];
    expect(button(render(1, "Alex").html)).toBe(`${SITE}/retreats/dashboard/bali-2027/memories`);
    expect(button(render(2, "Alex").html)).toBe(`${SITE}/retreats/dashboard/bali-2027/feedback`);
    expect(button(render(3, "Alex").html)).toBe(`${SITE}/retreats/dashboard/bali-2027/interest`);
    expect(button(render(4, "Alex").html)).toBe(`${SITE}/upcoming-retreats`);

    // A future retreat populates its own links with no edit to the emails.
    const later = { ...BALI, slug: "costa-rica-2028", title: "FlourisHealer Costa Rica 2028" };
    expect(button(render(1, "Alex", later).html)).toBe(`${SITE}/retreats/dashboard/costa-rica-2028/memories`);
    expect(button(render(4, "Alex", later).html)).toBe(`${SITE}/upcoming-retreats`);
  });

  it("carries Yvette's Email 4 wording exactly, and ships Email 4 switched off", () => {
    const e4 = ALUMNI_EMAILS[3];
    expect(e4.previewText).toBe("Stay connected to what's next for FlourisHealer.");
    expect(e4.bodyMd).toContain(
      "If an upcoming retreat catches your eye, you can explore the details and decide whether it fits your next chapter. If nothing is announced yet, you can sign up to hear when new retreats are available."
    );
    expect(e4.bodyMd).toContain('[Explore upcoming retreats]({{retreatNextUrl}} "button")');
    expect(ALUMNI_EMAILS.map((e) => e.enabled)).toEqual([true, true, true, false]);
  });

  it("gives each recipient her own signed unsubscribe link (the footer sendEmail appends)", () => {
    const link = mergeLinks(4242).unsubscribeUrl;
    expect(link).toMatch(/^https?:\/\/[^/]+\/api\/email\/unsubscribe\/[A-Za-z0-9_.-]+$/);
    expect(link).not.toMatch(/\/preview$/);
    expect(verifyPreferencesToken(link.split("/").pop() ?? "")).toBe(4242);
    expect(mergeLinks(4243).unsubscribeUrl).not.toBe(link);
  });

  it("goes out as UTF-8 through the mail transport, so an em dash never turns into '?'", async () => {
    const r = render(1, "Alex");
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    const info = await transport.sendMail({
      from: "Yvette <hello@example.com>",
      to: "alex@example.com",
      subject: `${r.subject} — test`,
      text: r.text,
      html: r.html,
    });
    const raw = (info.message as Buffer).toString("utf8");
    expect(raw).toMatch(/Content-Type: text\/plain; charset=utf-8/i);
    expect(raw).toMatch(/Content-Type: text\/html; charset=utf-8/i);
    expect(raw).toMatch(/^Subject: =\?UTF-8\?/im);
    // Decode each part the way a mail client does and look for the dash.
    const decoded = raw
      .split(/\n--/)
      .map((part) => {
        const [head, ...rest] = part.split("\n\n");
        const body = rest.join("\n\n");
        if (/Content-Transfer-Encoding: quoted-printable/i.test(head)) {
          const bytes = body.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
          return Buffer.from(bytes, "latin1").toString("utf8");
        }
        if (/Content-Transfer-Encoding: base64/i.test(head)) return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
        return body;
      })
      .join("\n");
    expect(decoded).toContain("retreat group—not a public marketing album");
    expect(decoded).not.toMatch(/group\?not/);
  });
});

describe("alumni emails: skip rules", () => {
  const none: RetreatGuestFacts = { feedbackSubmitted: false, interestSet: false, marketingOptedOut: false, bookedFeatured: false };
  const reason = (position: number, facts: Partial<RetreatGuestFacts>) =>
    retreatSkipReason(parseRetreatSkipRules(ALUMNI_EMAILS[position - 1].skipRules), { ...none, ...facts });

  it("sends all four to a guest who has done nothing yet", () => {
    for (const p of [1, 2, 3, 4]) expect(reason(p, {})).toBe("");
  });

  it("skips Email 2 once feedback is in, and nothing else for it", () => {
    expect(reason(2, { feedbackSubmitted: true })).toMatch(/feedback/);
    for (const p of [1, 3, 4]) expect(reason(p, { feedbackSubmitted: true })).toBe("");
  });

  it("skips Email 3 once interest is given", () => {
    expect(reason(3, { interestSet: true })).toMatch(/interest/);
    for (const p of [1, 2, 4]) expect(reason(p, { interestSet: true })).toBe("");
  });

  it("gives a guest who booked the featured retreat no booking call to action (Email 4)", () => {
    expect(reason(4, { bookedFeatured: true })).toMatch(/booked/);
    for (const p of [1, 2, 3]) expect(reason(p, { bookedFeatured: true })).toBe("");
  });

  it("skips the promotional Emails 3-4 for anybody who declined invitations, but keeps the gallery and feedback", () => {
    expect(reason(3, { marketingOptedOut: true })).toMatch(/declined/);
    expect(reason(4, { marketingOptedOut: true })).toMatch(/declined/);
    expect(reason(1, { marketingOptedOut: true })).toBe("");
    expect(reason(2, { marketingOptedOut: true })).toBe("");
  });

  it("treats Emails 1-2 as relationship mail and 3-4 as marketing (the unsubscribe switch each send honours)", () => {
    expect(ALUMNI_EMAILS.map((e) => e.topic)).toEqual(["", "", "marketing", "marketing"]);
  });
});

describe("alumni emails: timing", () => {
  it("goes Day +3, +7, +14, +21 after Bali's end date (20 Jun 2027), 9:00 a.m. Pacific — nothing before 23 Jun 2027", () => {
    expect(ALUMNI_EMAILS.map((e) => e.offsetDays)).toEqual([3, 7, 14, 21]);
    const dates = ALUMNI_EMAILS.map((e) => anchoredSendAt("2027-06-20", e.offsetDays, 540, "America/Los_Angeles").toISOString());
    expect(dates).toEqual([
      "2027-06-23T16:00:00.000Z",
      "2027-06-27T16:00:00.000Z",
      "2027-07-04T16:00:00.000Z",
      "2027-07-11T16:00:00.000Z",
    ]);
    for (const d of dates) expect(d >= "2027-06-23").toBe(true);
  });

  it("times every retreat from its own end date", () => {
    expect(anchoredSendAt("2028-03-10", ALUMNI_EMAILS[0].offsetDays, 540, "America/Los_Angeles").toISOString()).toBe(
      "2028-03-13T16:00:00.000Z"
    );
  });
});
