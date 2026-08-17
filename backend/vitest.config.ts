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
  },
});
