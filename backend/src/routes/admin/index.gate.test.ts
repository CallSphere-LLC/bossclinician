import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../email/mailer", () => ({ sendMail: vi.fn() }));

import { moduleGate } from "./index";

function run(gate: ReturnType<typeof moduleGate>, method: string, path: string, role: string) {
  let passed: unknown = "not called";
  gate({ method, path, user: { role } } as any, {} as any, (error?: unknown) => {
    passed = error;
  });
  return passed;
}

describe("moduleGate", () => {
  const contacts = moduleGate("contacts", ["/bulk/export.csv"]);

  // Support holds contacts.view but not contacts.manage.
  it("lets a view-only role download the ticked contacts, as it can the filtered list", () => {
    expect(run(contacts, "GET", "/export.csv", "support")).toBeUndefined();
    expect(run(contacts, "POST", "/bulk/export.csv", "support")).toBeUndefined();
  });

  it("still holds every other write to manage", () => {
    expect((run(contacts, "POST", "/bulk/delete", "support") as any)?.status).toBe(403);
    expect((run(contacts, "POST", "/bulk/tags", "support") as any)?.status).toBe(403);
    expect((run(contacts, "DELETE", "/bulk/export.csv", "support") as any)?.status).toBe(403);
    expect((run(moduleGate("contacts"), "POST", "/bulk/export.csv", "support") as any)?.status).toBe(403);
  });

  it("keeps the export behind view", () => {
    expect((run(contacts, "POST", "/bulk/export.csv", "coach") as any)?.status).toBe(403);
  });
});
