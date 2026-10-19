import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../config/env", () => ({ env: { publicSiteUrl: "https://bossclinician.callsphere.site", uploadDir: "/tmp", protectedUploadDir: "/tmp" } }));

import { confirmRedirectPath } from "./growthPublic";
import { formConfirmationEmail, formConfirmationLink } from "../../email/formConfirmation";

describe("the double opt-in confirmation link", () => {
  it("only ever lands on this site", () => {
    expect(confirmRedirectPath("/watch-now")).toBe("/watch-now");
    expect(confirmRedirectPath("https://bossclinician.callsphere.site/watch-now?x=1")).toBe("/watch-now?x=1");
    expect(confirmRedirectPath("https://evil.example/phish")).toBe("/");
    expect(confirmRedirectPath("//evil.example")).toBe("/");
    expect(confirmRedirectPath("")).toBe("/");
    expect(confirmRedirectPath(null)).toBe("/");
  });

  it("emails one absolute link to the API, with the token encoded", () => {
    const token = "abc+/=xyz";
    expect(formConfirmationLink(token)).toBe("https://bossclinician.callsphere.site/api/forms/confirm/abc%2B%2F%3Dxyz");
    const mail = formConfirmationEmail({ firstName: "Dr Jane", formName: "Freedom Masterclass", token, destination: "the masterclass", validDays: 30 });
    expect(mail.subject).toBe("Confirm your email to watch Freedom Masterclass");
    expect(mail.text).toContain(formConfirmationLink(token));
    expect(mail.html).toContain(`href="${formConfirmationLink(token)}"`);
    expect(mail.text).toContain("Hi Dr,");
  });
});
