import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What these tests protect: a teardown may only ever release the call it was
 * asked to end.
 *
 * Ending a call is not instant. The recorder's tail slice has to be uploaded,
 * the provider's close waits for its final usage — up to fifteen seconds before
 * it gives up — and the session row is closed over the network. All of that is
 * awaited, and `start` is deliberately free again the whole time, because the
 * alternative is a "Try again" button that does nothing for fifteen seconds.
 *
 * So a teardown that reads the hook's refs after those waits is reading the
 * NEXT call's microphone, audio element and session id. It stops a microphone
 * somebody is currently speaking into, leaves the previous one open, and blanks
 * the session id the new call needs to file its transcript and its hang-up.
 * Taking ownership synchronously is what makes that impossible, and that is
 * what is pinned below.
 */

const voiceFetch = vi.fn(async (_path: string, _init: RequestInit, _surface?: string) =>
  new Response(null, { status: 204 }));
const detachVoiceAgentAudioTap = vi.fn();

vi.mock("./api-client", () => ({
  voiceFetch: (path: string, init: RequestInit, surface?: string) => voiceFetch(path, init, surface),
  putVoiceRecording: vi.fn(async () => {}),
}));

vi.mock("./audio-tap", () => ({
  attachVoiceAgentAudioTap: vi.fn(),
  clearVoiceCaptions: vi.fn(),
  detachVoiceAgentAudioTap: () => detachVoiceAgentAudioTap(),
  getServerVoiceCaptions: () => [],
  getVoiceCaptions: () => [],
  ingestRealtimeCaptionEvent: vi.fn(),
  readVoiceAgentLevels: () => null,
  realtimeAgentSpeechState: () => null,
  subscribeVoiceCaptions: () => () => {},
}));

vi.mock("./connect", () => ({
  describeVoiceError: (cause: unknown) => String(cause),
  requestAdmission: vi.fn(),
}));

const { releaseOwnedCall, takeOwnedCall } = await import("./useVoiceSession");

type Refs = Parameters<typeof takeOwnedCall>[0];

/** A microphone that remembers whether anyone turned it off. */
function fakeMic(): { stream: MediaStream; stopped: () => boolean } {
  let stopped = false;
  const track = { stop: () => { stopped = true; } };
  return {
    stream: { getTracks: () => [track] } as unknown as MediaStream,
    stopped: () => stopped,
  };
}

function refsHolding(owned: Partial<Refs>): Refs {
  return {
    sessionId: { current: null },
    session: { current: null },
    recorder: { current: null },
    micStream: { current: null },
    audioElement: { current: null },
    ...owned,
  } as Refs;
}

beforeEach(() => {
  voiceFetch.mockReset();
  voiceFetch.mockResolvedValue(new Response(null, { status: 204 }));
  detachVoiceAgentAudioTap.mockClear();
});

describe("takeOwnedCall", () => {
  it("empties every ref and hands back what was in them", () => {
    const mic = fakeMic();
    const session = { beginClose: () => {}, close: async () => {} };
    const refs = refsHolding({
      sessionId: { current: "session-1" },
      session: { current: session as never },
      micStream: { current: mic.stream },
    });

    const owned = takeOwnedCall(refs);

    expect(owned.sessionId).toBe("session-1");
    expect(owned.session).toBe(session);
    expect(owned.micStream).toBe(mic.stream);
    expect(refs.sessionId.current).toBeNull();
    expect(refs.session.current).toBeNull();
    expect(refs.micStream.current).toBeNull();
    expect(refs.audioElement.current).toBeNull();
    expect(refs.recorder.current).toBeNull();
  });
});

describe("releaseOwnedCall", () => {
  it("releases the recorder, the provider and the session row in that order, then the microphone", async () => {
    const order: string[] = [];
    const mic = fakeMic();
    const owned = takeOwnedCall(refsHolding({
      sessionId: { current: "session-1" },
      session: { current: { beginClose: () => {}, close: async () => { order.push("close"); } } as never },
      recorder: { current: { stop: async () => { order.push("recorder"); }, flushOnUnload: () => {} } as never },
      micStream: { current: mic.stream },
    }));
    voiceFetch.mockImplementation(async () => {
      order.push("end");
      // The microphone is the goodbye's source; it may not go before the tail.
      expect(mic.stopped()).toBe(false);
      return new Response(null, { status: 204 });
    });

    await releaseOwnedCall(owned, "public", () => false);

    expect(order).toEqual(["recorder", "close", "end"]);
    expect(mic.stopped()).toBe(true);
    expect(detachVoiceAgentAudioTap).toHaveBeenCalledTimes(1);
  });

  it("stops the microphone it was given, never the one that replaced it", async () => {
    const ending = fakeMic();
    const next = fakeMic();
    const refs = refsHolding({
      sessionId: { current: "session-1" },
      micStream: { current: ending.stream },
    });

    const owned = takeOwnedCall(refs);
    // The person pressed "Try again" while the close was still draining: a
    // second call has already taken the microphone by the time this resumes.
    refs.micStream.current = next.stream;
    refs.sessionId.current = "session-2";
    await releaseOwnedCall(owned, "public", () => true);

    expect(ending.stopped()).toBe(true);
    expect(next.stopped()).toBe(false);
    expect(refs.micStream.current).toBe(next.stream);
    expect(refs.sessionId.current).toBe("session-2");
    // One hang-up, for the call that actually ended.
    expect(voiceFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(voiceFetch.mock.calls[0][1].body as string)).toMatchObject({ sessionId: "session-1" });
  });

  it("leaves the audio tap alone once another call owns it", async () => {
    const owned = takeOwnedCall(refsHolding({ micStream: { current: fakeMic().stream } }));

    await releaseOwnedCall(owned, "public", () => true);

    expect(detachVoiceAgentAudioTap).not.toHaveBeenCalled();
  });

  it("does nothing at all for a call that owns nothing", async () => {
    // The second teardown of the same call — a hangup racing a failure — must
    // not file a second end for a session that has already been closed out.
    await releaseOwnedCall(takeOwnedCall(refsHolding({})), "public", () => false);

    expect(voiceFetch).not.toHaveBeenCalled();
  });

  it("releases the microphone even when the provider's close never answers", async () => {
    const mic = fakeMic();
    const owned = takeOwnedCall(refsHolding({
      session: { current: { beginClose: () => {}, close: async () => { throw new Error("close timed out"); } } as never },
      micStream: { current: mic.stream },
    }));

    await releaseOwnedCall(owned, "public", () => false);

    expect(mic.stopped()).toBe(true);
  });
});
