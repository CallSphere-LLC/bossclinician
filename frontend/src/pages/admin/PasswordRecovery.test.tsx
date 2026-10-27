import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Routes, Route } from "react-router";
import { describe, expect, it, vi } from "vitest";
import PasswordRecovery from "./PasswordRecovery";
import Login from "./Login";
import MemberLogin from "../member/Login";
import MemberForgot from "../member/ForgotPassword";
import MemberReset from "../member/ResetPassword";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null, loading: false, login: vi.fn() }) }));
vi.mock("@/hooks/useMember", () => ({ useMember: () => ({ member: null, loading: false, signIn: vi.fn() }) }));
vi.mock("./AdminGoogleButton", () => ({ useAdminGoogleEnabled: () => false, adminGoogleErrorMessage: () => null }));

function render(path: string, element: React.ReactNode, route = "*") {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} /></Routes></MemoryRouter>);
}
describe("password recovery surfaces", () => {
  it("admin login offers recovery with the intended destination", () => {
    expect(render("/admin/login?next=%2Fadmin%2Foffers%2F42", <Login />)).toContain('href="/admin/forgot-password?next=%2Fadmin%2Foffers%2F42"');
  });
  it("member login offers recovery with the checkout destination", () => {
    expect(render("/login?next=%2Fcheckout%2Foffer", <MemberLogin />)).toContain('href="/forgot-password?next=%2Fcheckout%2Foffer"');
  });
  it("admin recovery stays unauthenticated and returns to admin login", () => {
    const html = render("/admin/forgot-password?next=%2Fadmin%2Foffers%2F42", <PasswordRecovery />);
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain('href="/admin/login?next=%2Fadmin%2Foffers%2F42"');
    expect(html).toContain("Send reset link");
  });
  it("incomplete admin links offer another request", () => {
    const html = render("/admin/reset-password", <PasswordRecovery reset />);
    expect(html).toContain("That link is incomplete");
    expect(html).toContain('href="/admin/forgot-password"');
    expect(html).not.toContain('type="password"');
  });
  it("admin reset has confirmation, no referrer and a recovery link", () => {
    const html = render("/admin/reset-password/synthetic?next=%2Fadmin%2Foffers%2F42", <PasswordRecovery reset />, "/admin/reset-password/:token");
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(html).toContain('name="referrer" content="no-referrer"');
    expect(html).toContain('href="/admin/forgot-password?next=%2Fadmin%2Foffers%2F42"');
  });
  it("member request and reset preserve the checkout destination", () => {
    expect(render("/forgot-password?next=%2Fcheckout%2Foffer", <MemberForgot />)).toContain('href="/login?next=%2Fcheckout%2Foffer"');
    const html = render("/reset-password/synthetic?next=%2Fcheckout%2Foffer", <MemberReset />, "/reset-password/:token");
    expect(html).toContain('href="/login?next=%2Fcheckout%2Foffer"');
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(html).toContain('name="referrer" content="no-referrer"');
  });
});
