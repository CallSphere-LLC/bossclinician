import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminSequencesRouter, MERGE_TOKEN_PATTERN } from "./sequences";

/**
 * Per-email figures for a sequence whose subject carries merge tags.
 *
 * The log holds the subject as sent ("Sam, your guide"), so matching it
 * exactly against "{{firstName}}, your guide" counted that email as never sent.
 */

const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] as unknown[] }));
vi.mock("../../db/pool", () => ({ pool: { query: (sql: string, params?: unknown[]) => query(sql, params) } }));
vi.mock("../../email/provider", () => ({
  marketingSettings: vi.fn(),
  mergeLinks: vi.fn(),
  renderMarkdown: vi.fn(),
  renderTokens: (template: string, values: Record<string, string>) =>
    template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => values[key] ?? ""),
  sendEmail: vi.fn(),
}));
vi.mock("../../email/mergeValues", () => ({
  MERGE_TAGS: [],
  MERGE_TAG_SOURCES: ["broadcast", "sequence", "transactional"],
  buildMergeValues: vi.fn(),
  customTokenKey: vi.fn(),
  mergeTagsFor: vi.fn(() => []),
}));
vi.mock("../../services/sequences", () => ({ enrollContact: vi.fn(), exitContact: vi.fn() }));
vi.mock("../../services/contacts", () => ({ upsertContact: vi.fn() }));

describe("GET /api/admin/sequences/:id/stats", () => {
  let base = "";
  let server: ReturnType<ReturnType<typeof express>["listen"]>;

  beforeAll(async () => {
    const app = express();
    app.use("/api/admin/sequences", adminSequencesRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("matches a tagged subject as a pattern, with the tag syntax renderTokens fills in", async () => {
    const res = await fetch(`${base}/api/admin/sequences/4/stats`);
    expect(res.status).toBe(200);

    const perEmail = query.mock.calls.find(([sql]) => sql.includes("FROM sequence_emails e"));
    expect(perEmail).toBeDefined();
    const [sql, params] = perEmail!;
    expect(sql).toMatch(/m\.subject LIKE/);
    expect(params).toEqual(["4", MERGE_TOKEN_PATTERN, "\\"]);

    // The same tokens renderTokens replaces, and nothing else.
    const token = new RegExp(MERGE_TOKEN_PATTERN, "g");
    expect("{{firstName}}, {{ custom.plan }} — {single} {{}}".match(token)).toEqual([
      "{{firstName}}",
      "{{ custom.plan }}",
    ]);
  });
});
