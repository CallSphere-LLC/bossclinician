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
    expect(subject).toBe("New form reply: Boardroom Application - Jane Bcc: x@evil.test");
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it("falls back to the address when no name was given", () => {
    expect(formSubmissionNotification({ ...reply, name: "" }).subject).toBe(
      "New form reply: Boardroom Application - jane@example.com",
    );
  });

  it("says opt-in for a public sign-up, drops the Forms screen's labels, and names the person", () => {
    const { subject, text } = formSubmissionNotification({
      ...reply,
      name: "Jane",
      formName: "Insurance vs Superbills Guide — opt-in",
      optIn: true,
    });
    expect(subject).toBe("New opt-in: Insurance vs Superbills Guide - Jane");
    expect(text).toContain('Jane (jane@example.com) opted in to "Insurance vs Superbills Guide".');
    expect(
      formSubmissionNotification({ ...reply, name: "Jane", formName: "Hiring Quiz — Sign-up (/hire-form)", optIn: true }).subject,
    ).toBe("New opt-in: Hiring Quiz - Jane");
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

  it("links to the replies in the admin when given the address, and only then", () => {
    const adminUrl = "https://admin.example.test/admin/marketing/forms-v2?form=7&view=replies";
    const linked = formSubmissionNotification({ ...reply, adminUrl });
    expect(linked.text).toContain(`See every reply to this form: ${adminUrl}`);
    expect(linked.html).toContain(`href="https://admin.example.test/admin/marketing/forms-v2?form=7&amp;view=replies"`);
    expect(formSubmissionNotification(reply).text).not.toContain("See every reply");
  });
});
