import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../config/env", () => ({ env: { openai: { baseUrl: "https://provider.test/v1", apiKey: "test-only" } }, voiceEnabled: () => true }));
vi.mock("./sessionStore", () => ({ endSession: vi.fn() }));
import { conciergeTurn } from "./liveSession";

const input = { surface: "public" as const, instructions: "Help", messages: [{ role: "user", content: "Hello" }], tools: [], stream: true };
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
function streamed(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    // Byte boundaries include the middle of Unicode characters.
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  }}), { headers: { "Content-Type": "text/event-stream" } });
}
afterEach(() => vi.unstubAllGlobals());
describe("provider text streaming", () => {
  it("forwards Unicode fragments and gets complete tool arguments from the terminal output", async () => {
    const output = [ { type: "message", content: [{ type: "output_text", text: "Café" }] }, { type: "function_call", call_id: "call-1", name: "navigate_to", arguments: '{"destination":"home"}' } ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamed(event({ type: "response.output_text.delta", delta: "Café" }) + event({ type: "response.completed", response: { output } }))));
    const deltas: string[] = [];
    const result = await conciergeTurn({ ...input, onDelta: (delta) => deltas.push(delta) });
    expect(deltas).toEqual(["Café"]);
    expect(result).toEqual({ ok: true, reply: "Café", toolCalls: [{ id: "call-1", name: "navigate_to", arguments: { destination: "home" } }] });
  });
  it("does not call a truncated stream a successful reply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamed(event({ type: "response.output_text.delta", delta: "Partial" }))));
    expect(await conciergeTurn(input)).toMatchObject({ ok: false, error: "The reply ended before it was finished." });
  });
  it("keeps supporting buffered provider responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ output: [{ type: "message", content: [{ text: "Complete" }] }] })));
    expect(await conciergeTurn(input)).toEqual({ ok: true, reply: "Complete", toolCalls: [] });
  });
});
