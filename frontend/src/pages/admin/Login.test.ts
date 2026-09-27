import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { loginErrorMessage } from "@/pages/admin/Login";

describe("loginErrorMessage", () => {
  it("blames the email or password only when the server said so", () => {
    expect(loginErrorMessage(new ApiError("Invalid email or password", 401))).toMatch(
      /email or password doesn't match/,
    );
  });

  it("says to wait when the limiter refused, not that the password is wrong", () => {
    const message = loginErrorMessage(new ApiError("Too many login attempts.", 429));
    expect(message).toMatch(/Too many sign-in attempts/);
    expect(message).not.toMatch(/password doesn't match/);
  });

  it("does not blame her details for a server or network failure", () => {
    expect(loginErrorMessage(new ApiError("boom", 500))).toMatch(/couldn't reach the server/);
    expect(loginErrorMessage(new TypeError("Failed to fetch"))).toMatch(/couldn't reach the server/);
  });
});
