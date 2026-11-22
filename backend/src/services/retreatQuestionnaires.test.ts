import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allQuestions,
  buildAnswers,
  conditionHolds,
  formatDateRange,
  parseDefinition,
  questionnaireKey,
  renderWording,
  responseStatus,
  sniffQuestionnaireFile,
  viewDefinition,
  type Definition,
  type ResponseRow,
} from "./retreatQuestionnaires";
import { buildAccessEmail, assertSendable } from "./retreatAccess";
import { duplicatedSettings } from "./retreatDuplicate";
import { normaliseSettings } from "./retreats";

const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "224_retreat_questionnaires_access.sql"), "utf8");
const seeded = [...MIGRATION.matchAll(/\$def\$([\s\S]*?)\$def\$/g)].map((m) => JSON.parse(m[1]) as unknown);

const ctx = { destination: "Ubud, Bali", startDate: "2027-06-15", endDate: "2027-06-20", title: "FlourisHealer Bali 2027", airport: "DPS" };

function def(questions: Definition["sections"][number]["questions"]): Definition {
  return { intro: "", sections: [{ id: "s", title: "S", description: "", questions }] };
}
const q = (id: string, patch: Record<string, unknown> = {}) =>
  ({ id, type: "short_text", label: id, help: "", required: false, options: [], showTo: "all", showIf: null, sensitive: false, ...patch }) as Definition["sections"][number]["questions"][number];

describe("seeded Bali questionnaires (migration 224)", () => {
  it("are three valid definitions", () => {
    expect(seeded).toHaveLength(3);
    for (const raw of seeded) expect(parseDefinition(raw).problems).toEqual([]);
  });

  it("carry Yvette's 22 Nov changes word for word", () => {
    const profile = parseDefinition(seeded[0]).definition!;
    const byId = new Map(allQuestions(profile).map(({ question }) => [question.id, question]));
    expect(byId.get("shared_room_friend")).toMatchObject({
      label: "If you arranged a shared room with a friend, please enter her full name.",
      showTo: "shared_room",
    });
    expect(byId.get("activities_to_skip")!.label).toBe("Are there any planned activities you would prefer to skip or discuss with us beforehand?");
    expect(byId.get("massage_comfort")!.options).toEqual(["Yes, absolutely", "Yes, with some areas avoided (please note below)", "I prefer not to receive a massage."]);
    expect(byId.get("accessibility_needs")!.label).toBe(
      "Are there any mobility, accessibility, or participation needs you would like us to consider? Please share only information relevant to arranging your retreat experience.",
    );
    expect(byId.get("medications")!.label).toBe("Any medications or medical needs we should be aware of?");
    expect(byId.get("diet")!.type).toBe("multiple_choice");
    expect(byId.get("allergies")!.type).toBe("long_text");
    expect(byId.get("instagram")!.required).toBe(false);
    expect(byId.get("photo")).toMatchObject({ type: "file", required: false });
    expect(byId.get("photo_share_permission")).toMatchObject({ type: "checkbox", required: false });
    expect(byId.get("coffee_tea")!.help).toBe("Your retreat mornings deserve to start exactly right");
    const text = JSON.stringify(profile);
    expect(text).not.toMatch(/completely confidential|alternative treatment|roommate|Bali mornings|thoughtfully pair/);
    // Flight details are their own form: the profile can be finished before booking.
    expect(text).not.toMatch(/flight number/i);
    const flights = parseDefinition(seeded[2]).definition!;
    const flightIds = allQuestions(flights).map(({ question }) => question.id);
    expect(flightIds).toEqual(expect.arrayContaining(["arrival_airline", "arrival_flight_number", "arrival_date", "arrival_time", "departure_date", "departure_time", "transfer_requests"]));
    expect(allQuestions(flights).find(({ question }) => question.id === "arrival_time")!.question.help).toBe("Local time at your arrival airport");
  });

  it("render with the retreat's destination and dates, never a leftover token", () => {
    const profile = parseDefinition(seeded[0]).definition!;
    const view = viewDefinition(profile, "private", ctx);
    expect(view.intro.startsWith("We are so excited to have you join us in Ubud, Bali, June 15–20, 2027!")).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/\{\{/);
    expect(JSON.stringify(view)).not.toContain("shared_room_friend");
    expect(JSON.stringify(viewDefinition(profile, "shared", ctx))).toContain("shared_room_friend");
    expect(JSON.stringify(viewDefinition(profile, "unknown", ctx))).not.toContain("shared_room_friend");
  });
});

describe("wording", () => {
  it("fills known tokens and strips unknown ones", () => {
    expect(renderWording("Join us in {{destination}}, {{dates}}!", ctx)).toBe("Join us in Ubud, Bali, June 15–20, 2027!");
    expect(renderWording("Hi {{firstName}}, see {{ retreat }}.", ctx)).toBe("Hi, see FlourisHealer Bali 2027.");
    expect(renderWording("{{weird stuff}} ok", ctx)).toBe(" ok");
  });

  it("formats date ranges across months and years", () => {
    expect(formatDateRange("2027-06-15", "2027-06-20")).toBe("June 15–20, 2027");
    expect(formatDateRange("2027-06-28", "2027-07-02")).toBe("June 28 – July 2, 2027");
    expect(formatDateRange("2027-12-30", "2028-01-02")).toBe("December 30, 2027 – January 2, 2028");
  });

  it("makes a safe key from a title", () => {
    expect(questionnaireKey("Content Day Prep!")).toBe("content-day-prep");
    expect(questionnaireKey("???")).toBe("questionnaire");
  });
});

describe("definition checks", () => {
  it("refuses duplicate ids, choice questions without options and broken conditions", () => {
    expect(parseDefinition(def([q("a"), q("a")])).problems.join(" ")).toContain("share the id");
    expect(parseDefinition(def([q("a", { type: "dropdown" })])).problems.join(" ")).toContain("needs at least one option");
    expect(parseDefinition(def([q("a", { showIf: { questionId: "missing", anyOf: [] } })])).problems.join(" ")).toContain("isn't in this questionnaire");
    expect(parseDefinition(def([q("a", { type: "single_choice", options: ["Yes"] }), q("b", { showIf: { questionId: "a", anyOf: ["No"] } })])).problems.join(" ")).toContain("doesn't offer");
    expect(parseDefinition({ intro: "", sections: [] }).definition).toBeNull();
    expect(parseDefinition(def([q("a", { type: "script" })])).definition).toBeNull();
  });
});

describe("answers", () => {
  const definition = def([
    q("name", { required: true }),
    q("diet", { type: "multiple_choice", options: ["Vegan", "Other"], required: true }),
    q("diet_other", { type: "long_text", showIf: { questionId: "diet", anyOf: ["Other"] } }),
    q("friend", { showTo: "shared_room" }),
    q("when", { type: "date" }),
    q("at", { type: "time" }),
    q("ok", { type: "checkbox", required: true }),
    q("photo", { type: "file" }),
  ]);
  const empty = { answers: {}, snapshot: {} };
  const build = (submitted: unknown, extra: Partial<Parameters<typeof buildAnswers>[0]> = {}) =>
    buildAnswers({ definition, version: 3, audience: "private", submitted, stored: empty, ownedFileIds: new Map([[7, "photo"]]), submit: false, ...extra });

  it("keeps only valid values for each type", () => {
    const out = build({ name: "  Ana ", diet: ["Vegan", "Meat"], when: "2027-02-30", at: "25:00", ok: "yes", photo: 8, junk: "x" });
    expect(out.answers).toEqual({ name: "Ana", diet: ["Vegan"] });
    expect(build({ when: "2027-06-15", at: "09:30", ok: true, photo: 7 }).answers).toEqual({ when: "2027-06-15", at: "09:30", ok: true, photo: 7 });
  });

  it("requires visible required questions only on submit", () => {
    expect(build({}).errors).toEqual({});
    expect(Object.keys(build({}, { submit: true }).errors).sort()).toEqual(["diet", "name", "ok"]);
  });

  it("drops a conditional answer whose condition no longer holds", () => {
    expect(build({ diet: ["Other"], diet_other: "Keto" }).answers.diet_other).toBe("Keto");
    expect(build({ diet: ["Vegan"], diet_other: "Keto" }).answers.diet_other).toBeUndefined();
    expect(conditionHolds(q("x", { showIf: { questionId: "photo", anyOf: [] } }), { photo: 7 })).toBe(true);
    expect(conditionHolds(q("x", { showIf: { questionId: "photo", anyOf: [] } }), {})).toBe(false);
  });

  it("ignores answers to a question hidden by room type, but keeps what was stored", () => {
    expect(build({ friend: "Jo" }).answers.friend).toBeUndefined();
    const stored = { answers: { friend: "Jo" }, snapshot: { friend: { label: "friend", type: "short_text" as const, section: "S", options: [], sensitive: false, version: 1 } } };
    expect(build({}, { stored }).answers.friend).toBe("Jo");
    expect(build({ friend: "Kim" }, { audience: "shared" }).answers.friend).toBe("Kim");
  });

  it("keeps answers to removed questions with their original wording, and snapshots new ones", () => {
    const stored = {
      answers: { snacks: "Chips", name: "Old" },
      snapshot: {
        snacks: { label: "What are your favorite snacks?", type: "long_text" as const, section: "FOOD", options: [], sensitive: false, version: 1 },
        name: { label: "Old label", type: "short_text" as const, section: "S", options: [], sensitive: false, version: 1 },
      },
    };
    const out = build({ name: "New", snacks: "ignored" }, { stored });
    expect(out.answers).toEqual({ snacks: "Chips", name: "New" });
    expect(out.snapshot.snacks.label).toBe("What are your favorite snacks?");
    expect(out.snapshot.name).toMatchObject({ label: "name", version: 3 });
  });

  it("derives the status, letting a review win only while it is newer than her change", () => {
    const row = (patch: Partial<ResponseRow>): ResponseRow => ({
      id: 1, questionnaire_id: 1, version: 1, answers: {}, question_snapshot: {}, state: "submitted", revision: 1,
      review_status: null, review_note: "", reviewed_at: null, updated_at: new Date("2027-01-02T00:00:00Z"), submitted_at: new Date("2027-01-02T00:00:00Z"), ...patch,
    });
    expect(responseStatus(undefined)).toBe("not_started");
    expect(responseStatus(row({ state: "draft" }))).toBe("in_progress");
    expect(responseStatus(row({}))).toBe("submitted");
    expect(responseStatus(row({ review_status: "verified", reviewed_at: new Date("2027-01-03T00:00:00Z") }))).toBe("verified");
    expect(responseStatus(row({ review_status: "verified", reviewed_at: new Date("2027-01-01T00:00:00Z") }))).toBe("submitted");
  });

  it("identifies uploads by their bytes", () => {
    expect(sniffQuestionnaireFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniffQuestionnaireFile(Buffer.from("%PDF-1.7"))?.mime).toBe("application/pdf");
    expect(sniffQuestionnaireFile(Buffer.from("<svg onload=x>"))).toBeNull();
  });
});

describe("access email", () => {
  const base = {
    firstName: "Sharon",
    email: "sharon@example.com",
    retreatTitle: "FlourisHealer Bali 2027",
    dates: "June 15–20, 2027",
    dashboardUrl: "https://www.bossclinician.com/retreats/dashboard/bali-2027",
    loginUrl: "https://www.bossclinician.com/login?next=%2Fretreats%2Fdashboard%2Fbali-2027",
    forgotPasswordUrl: "https://www.bossclinician.com/forgot-password?next=%2Fretreats%2Fdashboard%2Fbali-2027",
    supportEmail: "retreats@bossclinician.com",
  };

  it("says only what item 7 asks for, with a set-password link when she has no password", () => {
    const email = buildAccessEmail({ ...base, setPasswordUrl: "https://www.bossclinician.com/reset-password/abc?next=%2Fretreats" });
    expect(email.text).toContain("This is access for your existing reservation. No new purchase is required.");
    expect(email.text).toContain(`Open your dashboard: ${base.dashboardUrl}`);
    expect(email.text).toContain("Set your password here (this link works for 24 hours): https://www.bossclinician.com/reset-password/abc");
    expect(email.text).toContain("with this email address: sharon@example.com");
    expect(email.text).not.toMatch(/\$|price|deposit|balance|payment/i);
    expect(() => assertSendable(email)).not.toThrow();
  });

  it("points an account with a password to sign in and reset instead", () => {
    const email = buildAccessEmail({ ...base, setPasswordUrl: null });
    expect(email.text).not.toContain("Set your password");
    expect(email.text).toContain("If you don't remember your password, reset it at https://www.bossclinician.com/forgot-password");
    expect(email.html).toContain("retreats@bossclinician.com");
  });

  it("refuses to send an unresolved placeholder", () => {
    expect(() => assertSendable({ subject: "Hi {{firstName}}", text: "", html: "" })).toThrow();
  });
});

describe("duplicate retreat settings", () => {
  it("copies wording and choices but resets confirmed, date-bound details", () => {
    const source = normaliseSettings({
      welcomeMessage: "Join us in {{destination}}",
      inclusions: ["Villa"],
      shuttle: { confirmed: true, details: "10am" },
      groupCall: { confirmed: true, startsAt: "2027-05-01T17:00:00Z", joinUrl: "https://zoom.us/j/1", notes: "n", timezone: "America/New_York" },
      flightGuidance: { status: "booking_encouraged", note: "Book now" },
      passportValidThrough: "2027-12-20",
      transportNote: "June 15–20",
      deadlines: [{ label: "Profile due", date: "2027-04-01", note: "" }],
      checklist: { passport: false, groupCall: true },
    });
    const copy = duplicatedSettings(source, "SJO");
    expect(copy.welcomeMessage).toBe("Join us in {{destination}}");
    expect(copy.inclusions).toEqual(["Villa"]);
    expect(copy.checklist).toEqual({ passport: false, groupCall: true });
    expect(copy.shuttle).toEqual({ confirmed: false, details: "" });
    expect(copy.groupCall).toMatchObject({ confirmed: false, startsAt: null, joinUrl: "", timezone: "America/New_York" });
    expect(copy.flightGuidance).toEqual({ status: "researching", note: "" });
    expect(copy.passportValidThrough).toBeNull();
    expect(copy.transportNote).toBe("");
    expect(copy.deadlines).toEqual([{ label: "Profile due", date: null, note: "" }]);
    expect(copy.airport).toBe("SJO");
  });
});
