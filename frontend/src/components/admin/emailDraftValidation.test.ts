import { describe, expect, it } from "vitest";
import { validateCampaignDraft } from "./emailDraftValidation";

const NOW = Date.parse("2026-09-27T12:00:00Z");

describe("validateCampaignDraft — a scheduled send", () => {
  const later = new Date(NOW + 86_400_000).toISOString();

  it("asks for a subject before scheduling, as the server does", () => {
    // The schedule route refuses a blank subject after the email has already
    // been saved, so the refusal has to come before the save.
    const errors = validateCampaignDraft(
      { name: "Launch", subject: "  ", scheduledAt: later },
      { sendMode: "absolute", now: NOW },
    );
    expect(Object.keys(errors)).toEqual(["subject"]);
    expect(errors.subject).toMatch(/subject line/i);
  });

  it("saves a scheduled email with a subject, and a manual draft without one", () => {
    expect(
      validateCampaignDraft(
        { name: "Launch", subject: "Doors are open", scheduledAt: later },
        { sendMode: "absolute", now: NOW },
      ),
    ).toEqual({});
    expect(validateCampaignDraft({ name: "Launch", subject: "" }, { sendMode: "manual", now: NOW })).toEqual({});
  });
});
