import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import Login from "./Login";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { email: "admin@example.com" }, loading: false, login: vi.fn() }),
}));
vi.mock("./AdminGoogleButton", async (importOriginal) => ({
  ...await importOriginal<typeof import("./AdminGoogleButton")>(),
  useAdminGoogleEnabled: () => true,
}));

describe("Google callback with an existing admin session", () => {
  it("shows the rejected account instead of silently returning to the dashboard", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/login?error=google_no_account&next=%2Fadmin%2Fcommunity"]}><Login /></MemoryRouter>);
    expect(html).toContain("Google sign-in did not complete");
    expect(html).toContain("isn&#x27;t set up as an admin");
    expect(html).toContain("admin@example.com");
    expect(html).toContain('href="/admin/community"');
    expect(html).toContain("Continue with your existing session");
  });

  it("does not reflect arbitrary query text as an authentication error", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/login?error=untrusted-message"]}><Login /></MemoryRouter>);
    expect(html).not.toContain("untrusted-message");
    expect(html).not.toContain("Google sign-in did not complete");
  });
});
