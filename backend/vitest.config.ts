import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // bcrypt is a native addon and config/env reads process.env at import time,
    // so each suite gets its own process rather than sharing a worker thread.
    pool: "forks",
    // One bcrypt round at cost 12 is ~300ms on this box and the timing tests run
    // several back to back; the 5s default is too tight on slower CI hardware.
    testTimeout: 20_000,
    // config/env.ts throws at import without JWT_SECRET, and dotenv fills it
    // from backend/.env when one exists. Without this default the suite passed
    // only in checkouts that hold real secrets, and failed 36 files on a clean
    // machine (first seen in CI). Suites that need a specific value still set
    // their own; a variable already in the environment wins.
    env: { JWT_SECRET: process.env.JWT_SECRET ?? "unit-test-secret" },
  },
});
