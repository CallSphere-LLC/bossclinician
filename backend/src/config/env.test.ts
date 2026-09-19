import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The boot-time guard on JWT_SECRET.
 *
 * Each case re-imports config/env with a stubbed environment, because the module
 * reads process.env once at import time. dotenv does not overwrite a key that is
 * already present on process.env, so a stub of "" survives its own load of
 * backend/.env — which is exactly the deployment shape being guarded against.
 */
describe("required env vars", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("refuses a JWT_SECRET that is present but empty", async () => {
    vi.stubEnv("JWT_SECRET", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/JWT_SECRET/);
  });

  it("refuses a whitespace-only JWT_SECRET", async () => {
    vi.stubEnv("JWT_SECRET", "   ");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/JWT_SECRET/);
  });

  it("keeps a real secret verbatim", async () => {
    vi.stubEnv("JWT_SECRET", "a-real-secret");
    vi.resetModules();
    const { env } = await import("./env");
    expect(env.jwtSecret).toBe("a-real-secret");
  });
});
