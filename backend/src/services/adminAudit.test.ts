import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";

vi.mock("../db/pool", () => ({
  pool: { query: vi.fn(async () => Promise.reject(new Error("database unavailable"))) },
}));

import { recordAdminAction } from "./adminAudit";

/**
 * When an audit row cannot be written, the log line saying so is the only
 * trace left. The entity id is often a route parameter, so it must not be able
 * to rewrite that line: not as a format directive, not with a newline.
 */
describe("recordAdminAction's failure log", () => {
  it("keeps request data out of the format string and on one line", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await recordAdminAction({
        req: { ip: "203.0.113.9", admin: { id: 1 } } as unknown as Request,
        action: "contact.delete",
        entityType: "contact",
        entityId: "42 %s%o\n[audit] recorded contact.restore on contact:42",
      } as Parameters<typeof recordAdminAction>[0]);

      expect(error).toHaveBeenCalledTimes(1);
      const [format, ...args] = error.mock.calls[0];
      expect(format).toBe("[audit] failed to record %s on %s:%s (continuing):");
      const rendered = args.slice(0, 3).join(" ");
      expect(rendered).not.toMatch(/\n/);
      expect(rendered).toContain(JSON.stringify("42 %s%o\n[audit] recorded contact.restore on contact:42"));
    } finally {
      error.mockRestore();
    }
  });
});
