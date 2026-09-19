import { describe, expect, it, vi } from "vitest";
import type { ConciergeChatRequest, ConciergeChatResponse, ConciergeTool } from "@/voice/contract";
// The shared sentence, from the leaf both transports import. Asserted here so
// the wording the typed concierge relies on is guarded rather than assumed.
import { demotedNotice } from "@/voice/ui/demotion";
import {
  ConciergeLoopError,
  MAX_TOOL_OUTPUT_CHARS,
  MAX_WIRE_MESSAGES,
  readApprovalAnswer,
  runConciergeTurn,
  toolOutputContent,
} from "./conciergeLoop";

function fakeTool(name: string, execute: ConciergeTool["execute"]): ConciergeTool {
  return { name, description: name, parameters: { type: "object", properties: {} }, execute };
}

/** A server that answers with a scripted sequence, and remembers what it saw. */
function scriptedServer(script: Partial<ConciergeChatResponse>[]) {
  const seen: ConciergeChatRequest[] = [];
  let turn = 0;
  const send = vi.fn(async (request: ConciergeChatRequest) => {
    seen.push(structuredClone(request));
    const next = script[Math.min(turn, script.length - 1)];
    turn += 1;
    return { sessionId: "session-1", reply: null, toolCalls: [], ...next } as ConciergeChatResponse;
  });
  return { send, seen };
}

describe("runConciergeTurn", () => {
  const base = {
    surface: "public" as const,
    sessionId: null,
    history: [{ role: "user" as const, content: "where do I start?" }],
    getLocation: () => "/",
  };

  it("answers in one round when the model just talks", async () => {
    const server = scriptedServer([{ reply: "Start with the Blueprint." }]);
    const turn = await runConciergeTurn({ ...base, tools: [], send: server.send });

    expect(turn).toMatchObject({ reply: "Start with the Blueprint.", rounds: 1, sessionId: "session-1" });
    expect(server.seen[0].messages).toHaveLength(1);
  });

  it("runs tool calls locally, in order, and reports them back", async () => {
    const order: string[] = [];
    const tools = [
      fakeTool("navigate_to", async () => {
        order.push("navigate_to");
        return { ok: true, path: "/courses" };
      }),
      fakeTool("point_at", async () => {
        order.push("point_at");
        return "pointing at the Blueprint card";
      }),
    ];
    const server = scriptedServer([
      {
        reply: "Let me show you.",
        toolCalls: [
          { id: "c1", name: "navigate_to", arguments: { destination: "courses" } },
          { id: "c2", name: "point_at", arguments: { focus: "Blueprint" } },
        ],
      },
      { reply: "That is the Blueprint." },
    ]);

    const turn = await runConciergeTurn({ ...base, tools, send: server.send });

    expect(order).toEqual(["navigate_to", "point_at"]);
    expect(turn.toolNames).toEqual(["navigate_to", "point_at"]);
    expect(turn.interim).toEqual(["Let me show you."]);
    expect(turn.reply).toBe("That is the Blueprint.");
    expect(server.seen[1].messages.slice(-3)).toEqual([
      { role: "assistant", content: "Let me show you." },
      { role: "tool", toolCallId: "c1", name: "navigate_to", arguments: { destination: "courses" }, content: '{"ok":true,"path":"/courses"}' },
      { role: "tool", toolCallId: "c2", name: "point_at", arguments: { focus: "Blueprint" }, content: "pointing at the Blueprint card" },
    ]);
  });

  it("tells the model where the visitor is standing now, not where they started", async () => {
    let here = "/";
    const tools = [
      fakeTool("navigate_to", () => {
        here = "/courses";
        return { ok: true };
      }),
    ];
    const server = scriptedServer([
      { toolCalls: [{ id: "c1", name: "navigate_to", arguments: {} }] },
      { reply: "Here we are." },
    ]);

    await runConciergeTurn({ ...base, getLocation: () => here, tools, send: server.send });

    expect(server.seen.map((request) => request.path)).toEqual(["/", "/courses"]);
  });

  it("turns a thrown tool into output the model can answer for", async () => {
    const tools = [
      fakeTool("my_account_summary", () => {
        throw new Error("You are not signed in.");
      }),
    ];
    const server = scriptedServer([
      { toolCalls: [{ id: "c1", name: "my_account_summary", arguments: {} }] },
      { reply: "You will need to sign in first." },
    ]);

    const turn = await runConciergeTurn({ ...base, tools, send: server.send });

    expect(turn.reply).toBe("You will need to sign in first.");
    expect(server.seen[1].messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "c1",
      name: "my_account_summary",
      arguments: {},
      content: '{"ok":false,"error":"You are not signed in."}',
    });
  });

  it("refuses a tool this surface does not have without running anything", async () => {
    const execute = vi.fn();
    const server = scriptedServer([
      { toolCalls: [{ id: "c1", name: "delete_everything", arguments: {} }] },
      { reply: "I cannot do that here." },
    ]);

    await runConciergeTurn({
      ...base,
      tools: [fakeTool("navigate_to", execute)],
      send: server.send,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(server.seen[1].messages.at(-1)?.content).toContain("no tool called");
  });

  it("drops the oldest small talk rather than posting more than the route takes", async () => {
    const history = Array.from({ length: 60 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `line ${i}`,
    }));
    const server = scriptedServer([{ reply: "Still here." }]);

    await runConciergeTurn({ ...base, history, tools: [], send: server.send });

    expect(server.seen[0].messages).toHaveLength(MAX_WIRE_MESSAGES);
    expect(server.seen[0].messages.at(-1)).toEqual({ role: "assistant", content: "line 59" });
  });

  it("errors rather than stalling when the model says and does nothing", async () => {
    const server = scriptedServer([{ reply: null, toolCalls: [] }]);

    await expect(runConciergeTurn({ ...base, tools: [], send: server.send })).rejects.toMatchObject({
      name: "ConciergeLoopError",
      reason: "stalled",
    });
  });

  it("stops a model that keeps calling tools and never answers", async () => {
    const tools = [fakeTool("read_current_page", () => ({ ok: true }))];
    const server = scriptedServer([
      { toolCalls: [{ id: "c", name: "read_current_page", arguments: {} }] },
    ]);

    const failure = await runConciergeTurn({ ...base, tools, send: server.send, maxRounds: 3 }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ConciergeLoopError);
    expect((failure as ConciergeLoopError).reason).toBe("round-cap");
    expect(server.send).toHaveBeenCalledTimes(3);
  });
});

describe("the surface the server granted", () => {
  const base = {
    surface: "member" as const,
    sessionId: null,
    history: [{ role: "user" as const, content: "open my library" }],
    getLocation: () => "/library",
    tools: [],
  };

  it("reports it as soon as the server says so, before the answer", async () => {
    const heard: string[] = [];
    const server = scriptedServer([{ surface: "public", reply: "Here is what I can show you." }]);

    const turn = await runConciergeTurn({
      ...base,
      send: server.send,
      onSurface: (granted) => heard.push(granted),
    });

    expect(heard).toEqual(["public"]);
    expect(turn.grantedSurface).toBe("public");
  });

  it("says nothing when a server that predates the field answers", async () => {
    const heard: string[] = [];
    const server = scriptedServer([{ reply: "Here you are." }]);

    const turn = await runConciergeTurn({
      ...base,
      send: server.send,
      onSurface: (granted) => heard.push(granted),
    });

    expect(heard).toEqual([]);
    expect(turn.grantedSurface).toBeNull();
  });

  it("explains a demotion and stays quiet about everything else", () => {
    expect(demotedNotice("admin", "public")).toContain("signed out of the console");
    expect(demotedNotice("member", "public")).toContain("sign in and I can open your portal");
    expect(demotedNotice("public", "public")).toBeNull();
    expect(demotedNotice("member", "admin")).toBeNull();
  });
});

describe("toolOutputContent", () => {
  it("keeps a string as it is and says null for nothing at all", () => {
    expect(toolOutputContent("read the page")).toBe("read the page");
    expect(toolOutputContent(undefined)).toBe("null");
  });

  it("shortens an outsized page read rather than posting the whole document", () => {
    const content = toolOutputContent("x".repeat(MAX_TOOL_OUTPUT_CHARS + 500));
    expect(content.length).toBeLessThan(MAX_TOOL_OUTPUT_CHARS + 20);
    expect(content.endsWith("(shortened)")).toBe(true);
  });
});

describe("readApprovalAnswer", () => {
  it("reads a plain yes and a plain no", () => {
    expect(readApprovalAnswer("yes")).toEqual({ approved: true });
    expect(readApprovalAnswer("Nope.")).toEqual({ approved: false });
  });

  it("keeps the amendment that came with the yes", () => {
    expect(readApprovalAnswer("Yes, but make it a draft")).toEqual({
      approved: true,
      note: "but make it a draft",
    });
  });

  it("never reads consent out of the middle of a sentence", () => {
    expect(readApprovalAnswer("I don't think anyone would say no to that")).toBeNull();
    expect(readApprovalAnswer("nothing about this looks right")).toBeNull();
    expect(readApprovalAnswer("what does that change exactly?")).toBeNull();
  });
});
