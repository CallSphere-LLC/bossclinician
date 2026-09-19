import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveProtocol, liveAppendChunks } from "./live-protocol";

/**
 * The protocol is the only part of the kernel that can be tested without a
 * browser, and it is also the part where a quiet regression is most expensive:
 * a dropped function call is a concierge that says it navigated somewhere and
 * did not, and a caption that never flushes is a transcript that never reaches
 * the owner's session log. None of this needs a DOM, a socket or a key.
 */

type Event = Record<string, unknown>;

/** A protocol with both of its sides recorded, so order can be asserted. */
function harness() {
  const wire: Event[] = [];
  const emitted: Event[] = [];
  const protocol = new LiveProtocol(
    (event) => wire.push(event as Event),
    (event) => emitted.push(event as Event),
  );
  protocol.receive({ type: "session.started" });
  return { protocol, wire, emitted };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("liveAppendChunks", () => {
  it("keeps every chunk inside the provider's 480-byte append cap", () => {
    const text = "a".repeat(1500);
    const chunks = liveAppendChunks(text);

    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(480);
    }
  });

  it("measures bytes rather than characters, so multi-byte text still fits", () => {
    // Four bytes each: a character count would let this run to nearly 2 KB.
    const text = "😀".repeat(300);
    const chunks = liveAppendChunks(text);

    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(480);
      // A split inside a surrogate pair would produce a lone half-character.
      expect(chunk).not.toMatch(/[\uD800-\uDBFF]$/);
    }
  });

  it("returns nothing at all for empty text", () => {
    expect(liveAppendChunks("")).toEqual([]);
  });
});

describe("function calls", () => {
  /**
   * The provider's lifecycle snapshot arrives with `output: []`. The completed
   * items collected while the response was running are the authoritative list,
   * and the whole reason this class exists is that believing the snapshot
   * instead would mean no tool ever ran.
   */
  it("emits the collected call even though the lifecycle snapshot is empty", () => {
    const { protocol, emitted } = harness();

    protocol.receive({ type: "response.event", event: { type: "response.created" } });
    protocol.receive({
      type: "response.event",
      event: {
        type: "response.output_item.done",
        item: { type: "function_call", call_id: "call_1", name: "navigate_to", arguments: '{"key":"pricing"}' },
      },
    });
    protocol.receive({
      type: "response.event",
      event: { type: "response.completed", response: { output: [] } },
    });

    const done = emitted.find((event) => event.type === "response.done") as
      | { response: { output: { call_id: string }[] } }
      | undefined;
    expect(done?.response.output.map((call) => call.call_id)).toEqual(["call_1"]);

    const invocation = emitted.find(
      (event) => event.type === "response.function_call_arguments.done",
    ) as { call_id: string; name: string; arguments: string } | undefined;
    expect(invocation).toMatchObject({
      call_id: "call_1",
      name: "navigate_to",
      arguments: '{"key":"pricing"}',
    });
  });

  it("never emits the same call twice, however many lifecycle events arrive", () => {
    const { protocol, emitted } = harness();

    protocol.receive({ type: "response.event", event: { type: "response.created" } });
    protocol.receive({
      type: "response.event",
      event: {
        type: "response.output_item.done",
        item: { type: "function_call", call_id: "call_1", name: "read_current_page", arguments: "{}" },
      },
    });
    protocol.receive({ type: "response.event", event: { type: "response.completed", response: {} } });
    protocol.receive({ type: "response.event", event: { type: "response.cancelled", response: {} } });

    const invocations = emitted.filter(
      (event) => event.type === "response.function_call_arguments.done",
    );
    expect(invocations).toHaveLength(1);
  });

  it("sends the tool's answer and only then asks for the next turn", () => {
    const { protocol, wire } = harness();

    protocol.receive({ type: "response.event", event: { type: "response.created" } });
    protocol.receive({
      type: "response.event",
      event: {
        type: "response.output_item.done",
        item: { type: "function_call", call_id: "call_1", name: "point_at", arguments: "{}" },
      },
    });
    protocol.receive({ type: "response.event", event: { type: "response.completed", response: {} } });
    wire.length = 0;

    const output = { type: "function_call_output", call_id: "call_1", output: '{"ok":true}' };
    protocol.send({ type: "conversation.item.create", item: output });
    protocol.send({ type: "response.create" });

    expect(wire.map((event) => event.type)).toEqual(["response.item.create", "response.create"]);
    expect(wire[0]).toMatchObject({ item: output });
  });

  it("drops a duplicate answer for a call that has already been answered", () => {
    const { protocol, wire } = harness();

    protocol.receive({ type: "response.event", event: { type: "response.created" } });
    protocol.receive({
      type: "response.event",
      event: {
        type: "response.output_item.done",
        item: { type: "function_call", call_id: "call_1", name: "go_back", arguments: "{}" },
      },
    });
    protocol.receive({ type: "response.event", event: { type: "response.completed", response: {} } });
    wire.length = 0;

    const output = { type: "function_call_output", call_id: "call_1", output: "{}" };
    protocol.send({ type: "conversation.item.create", item: output });
    protocol.send({ type: "conversation.item.create", item: output });

    expect(wire.filter((event) => event.type === "response.item.create")).toHaveLength(1);
  });

  it("ignores everything until the provider has confirmed the session", () => {
    const wire: Event[] = [];
    const protocol = new LiveProtocol((event) => wire.push(event as Event), () => {});

    protocol.send({ type: "response.create" });

    expect(wire).toEqual([]);
  });
});

describe("captions", () => {
  it("streams a delta and flushes the settled line after the quiet period", () => {
    vi.useFakeTimers();
    const { protocol, emitted } = harness();

    protocol.receive({
      type: "session.input_transcript.delta",
      delta: "book me ",
      start_ms: 0,
      end_ms: 400,
    });
    protocol.receive({
      type: "session.input_transcript.delta",
      delta: "an appointment",
      start_ms: 400,
      end_ms: 900,
    });

    const deltas = emitted.filter(
      (event) => event.type === "conversation.item.input_audio_transcription.delta",
    );
    expect(deltas).toHaveLength(2);
    // Both halves of one utterance belong to one caption line.
    expect(new Set(deltas.map((event) => event.item_id)).size).toBe(1);
    expect(
      emitted.some((event) => event.type === "conversation.item.input_audio_transcription.completed"),
    ).toBe(false);

    vi.advanceTimersByTime(1200);

    const completed = emitted.find(
      (event) => event.type === "conversation.item.input_audio_transcription.completed",
    );
    expect(completed).toMatchObject({
      transcript: "book me an appointment",
      // A display fragment, never evidence that the turn is over.
      fragment: true,
      item_id: deltas[0].item_id,
      start_ms: 0,
      end_ms: 900,
    });
  });

  it("keeps the two speakers on separate lines", () => {
    vi.useFakeTimers();
    const { protocol, emitted } = harness();

    protocol.receive({ type: "session.input_transcript.delta", delta: "hello", start_ms: 0, end_ms: 100 });
    protocol.receive({ type: "session.output_transcript.delta", delta: "hi there", start_ms: 0, end_ms: 100 });
    vi.advanceTimersByTime(1200);

    expect(
      emitted.find((event) => event.type === "conversation.item.input_audio_transcription.completed"),
    ).toMatchObject({ transcript: "hello" });
    expect(
      emitted.find((event) => event.type === "response.output_audio_transcript.done"),
    ).toMatchObject({ transcript: "hi there" });
  });

  it("flushes whatever was mid-sentence when the session closes", () => {
    vi.useFakeTimers();
    const { protocol, emitted } = harness();

    protocol.receive({
      type: "session.output_transcript.delta",
      delta: "your next class is",
      start_ms: 0,
      end_ms: 500,
    });
    protocol.receive({ type: "session.closed", usage: { seconds: 42 } });

    // The half-spoken line still reaches the transcript, and it does so BEFORE
    // the close itself, so nothing downstream has to reopen a finished session.
    const flushIndex = emitted.findIndex(
      (event) => event.type === "response.output_audio_transcript.done",
    );
    const closeIndex = emitted.findIndex((event) => event.type === "session.closed");
    expect(flushIndex).toBeGreaterThanOrEqual(0);
    expect(flushIndex).toBeLessThan(closeIndex);
    expect(emitted[flushIndex]).toMatchObject({ transcript: "your next class is" });
    expect(protocol.usageSeconds).toBe(42);
  });

  it("stops sending once the session is closed", () => {
    const { protocol, wire } = harness();
    protocol.receive({ type: "session.closed", usage: {} });
    wire.length = 0;

    protocol.send({ type: "response.create" });

    expect(wire).toEqual([]);
  });
});


describe("graceful close boundary", () => {
  it("blocks queued work and all outgoing commands while retaining final transcripts and usage", () => {
    const { protocol, wire, emitted } = harness();
    protocol.receive({ type: "session.output_transcript.delta", delta: "Goodbye", start_ms: 0, end_ms: 500 });
    protocol.closing = true;
    protocol.send({ type: "response.create" });
    protocol.send({ type: "response.item.create", item: { type: "message", role: "user" } });
    protocol.receive({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", call_id: "late", name: "run_approved_action", arguments: "{}" } } });
    protocol.receive({ type: "response.event", event: { type: "response.completed", response: {} } });
    expect(wire).toEqual([]);
    expect(emitted.some((event) => event.type === "response.function_call_arguments.done")).toBe(false);
    protocol.receive({ type: "session.closed", usage: { seconds: 42 } });
    expect(protocol.usageSeconds).toBe(42);
    expect(protocol.closed).toBe(true);
    expect(emitted.some((event) => event.type === "response.output_audio_transcript.done")).toBe(true);
    expect(emitted.some((event) => event.type === "session.closed")).toBe(true);
  });
});
