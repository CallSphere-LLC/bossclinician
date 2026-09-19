import { describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => vi.fn());
vi.mock("@/voice/kernel/api-client", () => ({ voiceFetch: transport }));
import { readChatStream, streamConciergeChat } from "./chat-stream";

function response(parts: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) {
    parts.forEach((part) => controller.enqueue(encoder.encode(part)));
    controller.close();
  }}));
}

describe("concierge streaming", () => {
  it("sends JSON content type explicitly for admin chat transport", async () => {
    const result = { sessionId: "admin-chat", surface: "admin", reply: "Hello", toolCalls: [] };
    transport.mockResolvedValueOnce(Response.json(result));
    const request = { sessionId: null, surface: "admin" as const, path: "/admin", messages: [{ role: "user" as const, content: "Hello" }], tools: [] };
    expect(await streamConciergeChat(request, () => {})).toEqual(result);
    expect(transport).toHaveBeenLastCalledWith("/voice/chat", {
      method: "POST", headers: { Accept: "text/event-stream", "Content-Type": "application/json" }, body: JSON.stringify(request),
    }, "admin");
  });
  it("shows deltas before completion and preserves tool calls across split frames", async () => {
    const events: string[] = [];
    const final = { sessionId: "chat-1", surface: "public", reply: "Hello world", toolCalls: [{ id: "call-1", name: "read_current_page", arguments: {} }] };
    const wire = 'event: session\r\ndata: {"sessionId":"chat-1","surface":"public"}\r\n\r\nevent: delta\r\ndata: {"text":"Hello "}\r\n\r\nevent: delta\ndata: {"text":"world"}\n\nevent: done\ndata: ' + JSON.stringify(final) + '\n\n';
    const output = await readChatStream(response(Array.from(wire)), (delta) => events.push(delta), (session) => events.push(session.sessionId!));
    expect(events).toEqual(["chat-1", "Hello ", "world"]);
    expect(output).toEqual(final);
  });
  it("refuses partial replies without the completion event", async () => {
    await expect(readChatStream(response(['event: delta\ndata: {"text":"unfinished"}\n\n']), () => {})).rejects.toThrow("before it was finished");
  });
  it("reports provider failures after visible text", async () => {
    const deltas: string[] = [];
    await expect(readChatStream(response(['event: delta\ndata: {"text":"Hello"}\n\nevent: error\ndata: {"error":"Provider unavailable"}\n\n']), (text) => deltas.push(text))).rejects.toThrow("Provider unavailable");
    expect(deltas).toEqual(["Hello"]);
  });
});
