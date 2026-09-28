import { describe, expect, it } from "vitest";
import { formSubmissionNotification } from "./templates";

/**
 * The owner's copy of a form reply is built entirely out of what a stranger
 * typed, and it is HTML. These pin the two things that make that safe to send
 * and useful to read: every label and answer is escaped, and every answer is
 * there, in order, as "question: answer".
 */
describe("formSubmissionNotification", () => {
  const reply = {
    formName: "Boardroom Application",
    name: "Jane <b>Doe</b>",
    email: "jane@example.com",
    answers: [
      { label: "Full name", value: "Jane <b>Doe</b>" },
      { label: "What is the biggest challenge in your practice right now?", value: "Hiring, Owner pay" },
      { label: "If you stepped away for two weeks, what would stop?", value: "Intake\nBilling & <payroll>" },
    ],
  };

  it("names the form and the person in the subject, on one line", () => {
    const { subject } = formSubmissionNotification({ ...reply, name: "Jane\r\nBcc: x@evil.test" });
    expect(subject).toBe("New Boardroom Application: Jane Bcc: x@evil.test");
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it("falls back to the address when no name was given", () => {
    expect(formSubmissionNotification({ ...reply, name: "" }).subject).toBe(
      "New Boardroom Application: jane@example.com",
    );
  });

  it("lists every answer as label: value in the plain-text part", () => {
    const { text } = formSubmissionNotification(reply);
    expect(text).toContain("Full name: Jane <b>Doe</b>");
    expect(text).toContain("What is the biggest challenge in your practice right now?: Hiring, Owner pay");
    expect(text.indexOf("Full name")).toBeLessThan(text.indexOf("What is the biggest challenge"));
  });

  it("escapes every label and answer in the HTML part and keeps line breaks", () => {
    const { html } = formSubmissionNotification(reply);
    expect(html).not.toContain("<b>");
    expect(html).toContain("Jane &lt;b&gt;Doe&lt;/b&gt;");
    expect(html).toContain("Intake<br>Billing &amp; &lt;payroll&gt;");
    expect(html).toContain("<strong>Full name:</strong>");
  });
});
