import { describe, expect, it } from "vitest";
import { renderTokens } from "../../email/provider";
import { buildMergeValues } from "../../email/mergeValues";
import { delayFrom } from "./sequences";

const links = { loginUrl: "https://example.test/login", startUrl: "https://example.test/library", unsubscribeUrl: "https://example.test/unsubscribe" };

describe("QA 176 email personalization and delays", () => {
  it("uses a contact's first name for both spellings, including in a subject", () => {
    const values = buildMergeValues({ email: "yvette@example.test", name: "Yvette Howard", firstName: "Yvette" }, links);
    expect(renderTokens("Hi {{firstName}} and {{firstname}}", values)).toBe("Hi Yvette and Yvette");
    expect(renderTokens("{{firstname}}, your update", values)).toBe("Yvette, your update");
  });

  it("uses there when a contact has no name, and escapes rich HTML", () => {
    const values = buildMergeValues({ email: "a@example.test", name: "" }, links);
    expect(renderTokens("Hi {{firstname}}", values)).toBe("Hi there");
    expect(renderTokens("<!--bc:rich-email--><p>{{firstname}}</p>", { firstName: "<Ada>" })).toContain("&lt;Ada&gt;");
  });

  it("stores mixed week, day, hour and minute waits exactly", () => {
    expect(delayFrom({ waitWeeks: 1, waitDays: 2, waitHours: 3, waitMinutes: 4 })).toBe(10080 + 2880 + 180 + 4);
    expect(delayFrom({ waitMinutes: 5 })).toBe(5);
    expect(delayFrom({ waitWeeks: 0, waitDays: 0, waitHours: 0, waitMinutes: 0 })).toBe(0);
  });
});
