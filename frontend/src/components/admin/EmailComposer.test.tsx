import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EmailComposer, {
  EMAIL_STARTERS,
  PREVIEW_DEVICES,
  applyEmailFormat,
  previewWidthClass,
} from "./EmailComposer";
import {
  CAMPAIGN_FIELDS,
  SEQUENCE_EMAIL_FIELDS,
  saveBlockedSummary,
  validateCampaignDraft,
  validateSequenceEmailDraft,
} from "./emailDraftValidation";

describe("EmailComposer", () => {
  it("offers reusable starters and content blocks", () => {
    const html = renderToStaticMarkup(<EmailComposer value="" onChange={() => undefined} />);

    expect(html).toContain("Start from a template");
    expect(html).toContain("Welcome");
    expect(html).toContain("Add a content block");
    expect(html).toContain("Button");
    expect(EMAIL_STARTERS[0].body).toContain("{{firstName}}");
  });

  it("keeps the template library reachable once there is something written", () => {
    // The library used to render only while the composer was empty, so the one
    // moment it was most wanted — half an email written, a saved layout that
    // would have saved the work — was the one moment it could not be opened.
    const written = renderToStaticMarkup(
      <EmailComposer value="Hi there," onChange={() => undefined} />,
    );

    expect(written).not.toContain("Start from a template");
    expect(written).toContain("Templates");
    expect(written).toContain("Save as template");
  });

  it("previews at two distinct widths, one of them a fixed phone width", () => {
    // 3.11. The preview rendered at one width only. "Phone" has to be a fixed
    // narrow width and not the viewport: a preview that inherits the window
    // shows the desktop layout on a desktop and cannot show the other at all.
    expect(PREVIEW_DEVICES).toEqual(["desktop", "mobile"]);
    expect(previewWidthClass("mobile")).toContain("w-[390px]");
    expect(previewWidthClass("mobile")).toContain("max-w-full");
    expect(previewWidthClass("desktop")).not.toContain("w-[");
    expect(previewWidthClass("desktop")).not.toBe(previewWidthClass("mobile"));
  });

  it("formats selected text while preserving the caret range", () => {
    const edit = applyEmailFormat("bold", "Hello world", 6, 11);

    expect(edit).toEqual({ value: "Hello **world**", selectionStart: 8, selectionEnd: 13 });
  });
});

/* ---------------------------------------------------------------------------
 * A1. Save must never die silently.
 *
 * Ticking "Test a second subject line" and leaving it empty made "Save email"
 * do nothing: `required` on the B field let the browser cancel the submit, its
 * bubble never showed (the Save button is in the dialog footer, outside the
 * form), and no request was ever made. These tests pin both halves of the fix:
 * every refusal is a sentence keyed to a field the form shows it beside, and
 * no email form hands the browser a silent veto again.
 * ------------------------------------------------------------------------- */

const source = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const NOW = Date.parse("2026-09-11T12:00:00Z");
const valid = { name: "March launch", subject: "Doors are open", subjectB: "", abSplitPercent: 0 };

describe("A1 — saving an email always explains a refusal", () => {
  it("names the empty second subject line, and nothing else, when that is the only problem", () => {
    const errors = validateCampaignDraft(
      { ...valid, abSplitPercent: 50, subjectB: "" },
      { sendMode: "manual", now: NOW },
    );

    expect(Object.keys(errors)).toEqual(["subjectB"]);
    expect(errors.subjectB).toMatch(/second subject line/i);
    expect(errors.subjectB).toMatch(/untick/i);
    expect(saveBlockedSummary(errors, CAMPAIGN_FIELDS)).toContain(errors.subjectB);
  });

  it("saves the moment the second subject line is filled in, or the test is switched off", () => {
    const ctx = { sendMode: "manual" as const, now: NOW };
    expect(validateCampaignDraft({ ...valid, abSplitPercent: 50, subjectB: "Another way" }, ctx)).toEqual({});
    expect(validateCampaignDraft({ ...valid, abSplitPercent: 0, subjectB: "" }, ctx)).toEqual({});
    expect(saveBlockedSummary({}, CAMPAIGN_FIELDS)).toBeNull();
  });

  it("gives every blocked combination a non-empty message on a known field", () => {
    const soon = new Date(NOW + 30 * 60_000).toISOString();
    const later = new Date(NOW + 7 * 86_400_000).toISOString();
    let blocked = 0;
    for (const name of ["", "  ", "ZZ"])
      for (const subject of ["", "A"])
        for (const subjectB of ["", "B"])
          for (const abSplitPercent of [0, 25])
            for (const sendMode of ["manual", "absolute", "event_start", "event_registration"] as const)
              for (const scheduledAt of [null, "not a date", new Date(NOW - 1).toISOString(), later])
                for (const anchorEventId of [null, 7])
                  for (const anchorEvent of [null, { title: "Webinar", startsAt: null }, { title: "Webinar", startsAt: soon }, { title: "Webinar", startsAt: later }])
                    for (const anchorOffsetMinutes of [-1440, 0]) {
                      const errors = validateCampaignDraft(
                        { name, subject, subjectB, abSplitPercent, scheduledAt, anchorEventId, anchorOffsetMinutes },
                        { sendMode, now: NOW, anchorEvent },
                      );
                      const entries = Object.entries(errors);
                      for (const [field, message] of entries) {
                        expect(CAMPAIGN_FIELDS).toContain(field);
                        expect(typeof message === "string" && message.trim().length > 10).toBe(true);
                      }
                      const summary = saveBlockedSummary(errors, CAMPAIGN_FIELDS);
                      expect(summary === null).toBe(entries.length === 0);
                      if (summary) blocked += 1;
                    }
    expect(blocked).toBeGreaterThan(1000);
  });

  it("refuses sequence emails with a reason for a blank subject or an out-of-range wait", () => {
    expect(validateSequenceEmailDraft({ subject: "Hi", waitDays: 1, waitHours: 0 })).toEqual({});
    const errors = validateSequenceEmailDraft({ subject: " ", waitDays: 400, waitHours: 30 });
    expect(Object.keys(errors).sort()).toEqual(["subject", "waitDays", "waitHours"]);
    for (const message of Object.values(errors)) expect(message?.length).toBeGreaterThan(10);
  });

  it("renders a message slot and a focusable id for every field that can block a save", () => {
    const campaigns = source("../../pages/admin/Campaigns.tsx");
    for (const field of CAMPAIGN_FIELDS) {
      expect(campaigns).toContain(`fieldErrors.${field}`);
      expect(campaigns).toContain(`CAMPAIGN_FIELD_IDS.${field}`);
    }
    const sequenceEditor = source("../../pages/admin/SequenceEditor.tsx");
    for (const field of SEQUENCE_EMAIL_FIELDS) {
      expect(sequenceEditor).toContain(`emailErrors.${field}`);
      expect(sequenceEditor).toContain(`SEQUENCE_EMAIL_FIELD_IDS.${field}`);
    }
  });

  it("gives the browser no silent veto over any email form", () => {
    for (const file of [
      "../../pages/admin/Campaigns.tsx",
      "../../pages/admin/SequenceEditor.tsx",
      "../../pages/admin/Sequences.tsx",
    ]) {
      const text = source(file);
      const forms = text.match(/<form\b[^>]*>/g) ?? [];
      expect(forms.length, file).toBeGreaterThan(0);
      for (const form of forms) expect(form, `${file}: ${form}`).toContain("noValidate");
      // A bare `required` attribute on a control, on its own line or inline.
      expect(text, file).not.toMatch(/^\s*required(=\{true\})?\s*$/m);
      expect(text, file).not.toMatch(/<(Input|input|Textarea|textarea|select)\b[^>]*\srequired[\s/>]/);
    }
  });

  it("has exactly one way out of the campaign save before the request: after saying why", () => {
    const campaigns = source("../../pages/admin/Campaigns.tsx");
    const start = campaigns.indexOf("async function save(");
    const end = campaigns.indexOf("async function sendTest(");
    expect(start).toBeGreaterThan(-1);
    const beforeRequest = campaigns.slice(start, campaigns.indexOf("try {", start));
    expect(end).toBeGreaterThan(start);
    // The unreachable no-draft guard, and the refusal that follows the toast.
    expect(beforeRequest.match(/\breturn\b/g)).toHaveLength(2);
    expect(beforeRequest.indexOf("toast.error(summary)")).toBeLessThan(beforeRequest.lastIndexOf("return"));
    expect(beforeRequest).toContain("setShowErrors(true)");
  });
});
