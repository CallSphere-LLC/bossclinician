import { describe, expect, it, vi } from "vitest";
import { buildProposeAdminActionTool, buildRunApprovedActionTool, createProposalStore } from "./admin-actions";
import type { VoiceContext, ToolFn } from "../contract";

const tool: ToolFn = (value) => value;
function setup(approved: boolean, via: "click" | "voice" = "click") {
  const post = vi.fn(async (path: string) => path === "/voice/admin-catalog/prepare"
    ? { resource: "tags", action: "create", path: "/admin/tags", method: "POST", body: { name: "Approved tag" } }
    : path === "/voice/approval" ? { approvalId: "9" } : { id: 123 });
  const context: VoiceContext = {
    surface: "admin", mode: "text", navigate: () => {}, getLocation: () => "/admin/tags", getSessionId: () => "session-1",
    call: { get: vi.fn(), post: post as VoiceContext["call"]["post"], put: vi.fn(), del: vi.fn() },
    requestApproval: vi.fn(async () => ({ approved, via })),
  };
  const store = createProposalStore();
  return { context, post, propose: buildProposeAdminActionTool(tool, context, store), run: buildRunApprovedActionTool(tool, context, store) };
}

describe("exact-payload admin operations", () => {
  it("shows normalized payload for approval, executes exactly that payload once", async () => {
    const { context, post, propose, run } = setup(true);
    const proposal = await propose.execute({ actionId: "admin.request", params: { resource: "tags", action: "create", body: { name: " Approved tag " } } });
    expect(context.requestApproval).toHaveBeenCalledWith(expect.objectContaining({ details: expect.arrayContaining([{ label: "name", value: "Approved tag" }]) }));
    expect(post.mock.calls.some(([path]) => path === "/admin/tags")).toBe(false);
    expect(proposal).toContain("admin.request#1");
    expect(await run.execute({ proposalId: "admin.request#1" })).toContain("Done.");
    expect(post).toHaveBeenCalledWith("/admin/tags", { name: "Approved tag" });
    await run.execute({ proposalId: "admin.request#1" });
    expect(post.mock.calls.filter(([path]) => path === "/admin/tags")).toHaveLength(1);
  });
  it("cannot execute a declined or voice-only sensitive operation", async () => {
    for (const [approved, via] of [[false, "click"], [true, "voice"]] as const) {
      const { post, propose, run } = setup(approved, via);
      await propose.execute({ actionId: "admin.request", params: { resource: "tags", action: "create", body: { name: "QA" } } });
      await run.execute({ proposalId: "admin.request#1" });
      expect(post.mock.calls.some(([path]) => path === "/admin/tags")).toBe(false);
    }
  });
});
