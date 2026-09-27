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

describe("record-targeting actions resolve the record before approval", () => {
  function withData(approved = true) {
    const posts = [
      { id: 1, title: "Burnout recovery", slug: "burnout-recovery", published: false },
      { id: 2, title: "Beating burnout", slug: "beating-burnout", published: false },
      { id: 3, title: "Raising your rates", slug: "raising-your-rates", published: false },
    ];
    const leads = [
      { id: 10, name: "Joanne Smith", email: "jo@example.test", status: "new" },
      { id: 11, name: "Ann Lee", email: "ann@example.test", status: "new" },
    ];
    const get = vi.fn(async (path: string) => {
      if (path === "/admin/blog") return posts;
      if (path === "/admin/leads") return leads;
      if (path === "/admin/contacts/42") return { id: 42, name: "Real Person", email: "real@example.test" };
      throw new Error(`unexpected GET ${path}`);
    });
    const put = vi.fn(async () => ({}));
    const post = vi.fn(async (path: string) => (path === "/voice/approval" ? { approvalId: "7" } : { ok: true }));
    const context: VoiceContext = {
      surface: "admin", mode: "text", navigate: () => {}, getLocation: () => "/admin", getSessionId: () => "session-1",
      call: { get: get as VoiceContext["call"]["get"], post: post as VoiceContext["call"]["post"], put: put as VoiceContext["call"]["put"], del: vi.fn() },
      requestApproval: vi.fn(async () => ({ approved, via: "click" as const })),
    };
    const store = createProposalStore();
    return { context, get, put, post, posts, leads, propose: buildProposeAdminActionTool(tool, context, store), run: buildRunApprovedActionTool(tool, context, store) };
  }

  it("asks which post when a partial title fits two, without showing a card", async () => {
    const { context, put, propose } = withData();
    const answer = await propose.execute({ actionId: "blog.publish", params: { title: "burnout" } });
    expect(answer).toContain("not ready to approve");
    expect(answer).toContain("Burnout recovery");
    expect(answer).toContain("Beating burnout");
    expect(context.requestApproval).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("names the real post on the card and publishes that exact post", async () => {
    const { context, put, propose, run } = withData();
    await propose.execute({ actionId: "blog.publish", params: { title: "rates" } });
    expect(context.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.arrayContaining([{ label: "Post", value: "Raising your rates" }]) }),
    );
    expect(await run.execute({ proposalId: "blog.publish#1" })).toContain("Done.");
    expect(put).toHaveBeenCalledWith("/admin/blog/3", expect.objectContaining({ published: true }));
  });

  it("keeps a re-published post's first publication date", async () => {
    const { posts, put, propose, run } = withData();
    Object.assign(posts[2], { publishedAt: "2026-03-01T09:00:00.000Z" });
    await propose.execute({ actionId: "blog.publish", params: { title: "rates" } });
    await run.execute({ proposalId: "blog.publish#1" });
    expect(put).toHaveBeenCalledWith("/admin/blog/3", {
      published: true,
      publishedAt: "2026-03-01T09:00:00.000Z",
    });
  });

  it("names the resolved enquiry on the card and files that exact one", async () => {
    const { context, put, propose, run } = withData();
    await propose.execute({ actionId: "lead.status", params: { person: "ann lee", status: "contacted" } });
    expect(context.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.arrayContaining([{ label: "Enquiry", value: "Ann Lee" }]) }),
    );
    await run.execute({ proposalId: "lead.status#1" });
    expect(put).toHaveBeenCalledWith("/admin/leads/11", { status: "contacted" });
  });

  it("asks which enquiry when a first name fits two people", async () => {
    const { context, put, propose } = withData();
    const answer = await propose.execute({ actionId: "lead.status", params: { person: "ann", status: "contacted" } });
    expect(answer).toContain("not ready to approve");
    expect(answer).toContain("Joanne Smith");
    expect(context.requestApproval).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("treats a repeat enquiry from one address as one person and files the newest", async () => {
    const { context, put, leads, propose, run } = withData();
    // Newest first, as GET /admin/leads orders them.
    leads.unshift({ id: 12, name: "Ann Lee", email: "ann@example.test", status: "new" });
    await propose.execute({ actionId: "lead.status", params: { person: "Ann Lee", status: "contacted" } });
    expect(context.requestApproval).toHaveBeenCalled();
    await run.execute({ proposalId: "lead.status#1" });
    expect(put).toHaveBeenCalledWith("/admin/leads/12", { status: "contacted" });
  });

  it("still asks when two different people share a name", async () => {
    const { context, leads, propose } = withData();
    leads.unshift({ id: 13, name: "Ann Lee", email: "ann.other@example.test", status: "new" });
    const answer = await propose.execute({ actionId: "lead.status", params: { person: "Ann Lee", status: "contacted" } });
    expect(answer).toContain("ann.other@example.test");
    expect(context.requestApproval).not.toHaveBeenCalled();
  });

  it("refuses an unknown enquiry state before asking her to approve it", async () => {
    const { context, propose } = withData();
    const answer = await propose.execute({ actionId: "lead.status", params: { person: "Ann Lee", status: "won" } });
    expect(answer).toContain("not ready to approve");
    expect(context.requestApproval).not.toHaveBeenCalled();
  });

  it("labels a note's card with the contact the id really belongs to", async () => {
    const { context, post, propose, run } = withData();
    await propose.execute({ actionId: "contact.note", params: { contactId: 42, person: "Someone Else", note: "Call back Friday" } });
    expect(context.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.arrayContaining([{ label: "Person", value: "Real Person" }]) }),
    );
    await run.execute({ proposalId: "contact.note#1" });
    expect(post).toHaveBeenCalledWith("/admin/contacts/42/notes", { body: "Call back Friday" });
  });
});
