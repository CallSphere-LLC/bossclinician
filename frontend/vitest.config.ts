import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Frontend unit tests.
 *
 * Node environment, not jsdom: what is tested here is the pure logic the admin
 * screens lean on — date formatting in an event's own zone, and the like. None
 * of it touches the DOM, and a jsdom environment would only add a dependency
 * and a second set of globals for tests that never use them.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
