import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "@/voice/contract";
import { createApprovalStore } from "./approval-store";

/**
 * The rules about who may approve what are the part of the concierge that has
 * to be right every time, so they are tested away from React, the microphone
 * and the network — which is also why the store was written without them.
 */

function makeRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    actionId: "act-1",
    title: "Move Thursday's class to 7pm",
    summary: "Shifts one class and tells the eleven people booked into it.",
    details: [{ label: "Starts", value: "6pm → 7pm" }],
    risk: "normal",
    ...overrides,
  };
}

describe("approval store", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with a click and records that it was a click", async () => {
    const store = createApprovalStore();
    const outcome = store.request(makeRequest());
    expect(store.getSnapshot()).toHaveLength(1);

    expect(store.answerByClick("act-1", true)).toEqual({ accepted: true });
    await expect(outcome).resolves.toEqual({ approved: true, via: "click" });
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it("carries a typed amendment through as the note", async () => {
    const store = createApprovalStore();
    const outcome = store.request(makeRequest());

    store.answerByChat("act-1", true, "yes, but keep it a draft");
    await expect(outcome).resolves.toEqual({
      approved: true,
      via: "chat",
      note: "yes, but keep it a draft",
    });
  });

  it("takes a spoken yes for an ordinary change", async () => {
    const store = createApprovalStore();
    const outcome = store.request(makeRequest());

    expect(store.answerByVoice("act-1", true)).toEqual({ accepted: true });
    await expect(outcome).resolves.toEqual({ approved: true, via: "voice" });
  });

  it("refuses a spoken yes for a destructive change and keeps the card up", async () => {
    const store = createApprovalStore();
    const outcome = store.request(makeRequest({ risk: "destructive" }));

    expect(store.answerByVoice("act-1", true)).toEqual({
      accepted: false,
      reason: "needs-click-or-typed",
    });
    expect(store.getSnapshot()).toHaveLength(1);

    store.answerByClick("act-1", true);
    await expect(outcome).resolves.toEqual({ approved: true, via: "click" });
  });

  it("always takes a spoken no, even for a destructive change", async () => {
    const store = createApprovalStore();
    const outcome = store.request(makeRequest({ risk: "destructive" }));

    expect(store.answerByVoice("act-1", false)).toEqual({ accepted: true });
    await expect(outcome).resolves.toEqual({ approved: false, via: "voice" });
  });

  it("turns silence into a no", async () => {
    const store = createApprovalStore({ timeoutMs: 1_000 });
    const outcome = store.request(makeRequest());

    vi.advanceTimersByTime(1_000);
    await expect(outcome).resolves.toEqual({ approved: false, via: "timeout" });
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it("cancels everything still waiting when the conversation ends", async () => {
    const store = createApprovalStore();
    const first = store.request(makeRequest());
    const second = store.request(makeRequest({ actionId: "act-2" }));

    store.cancel();
    await expect(first).resolves.toEqual({ approved: false, via: "cancelled" });
    await expect(second).resolves.toEqual({ approved: false, via: "cancelled" });
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it("tells a second answer apart from a nonsense one", async () => {
    const store = createApprovalStore();
    const outcome = store.request(makeRequest());
    store.answerByClick("act-1", true);
    await outcome;

    expect(store.answerByVoice("act-1", true)).toEqual({
      accepted: false,
      reason: "already-answered",
    });
    expect(store.answerByVoice("act-99", true)).toEqual({
      accepted: false,
      reason: "unknown-request",
    });
  });

  it("hands out the same snapshot until something changes", () => {
    const store = createApprovalStore();
    const empty = store.getSnapshot();
    expect(store.getSnapshot()).toBe(empty);

    store.request(makeRequest());
    const pending = store.getSnapshot();
    expect(store.getSnapshot()).toBe(pending);
    expect(pending).not.toBe(empty);
  });

  it("wakes every listener when the queue changes", () => {
    const store = createApprovalStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.request(makeRequest());
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.answerByClick("act-1", true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
