import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The chat session id is what the server files a conversation under, and anyone
 * holding it can write lines into that conversation. It must never be
 * guessable, including on the browsers that lack `crypto.randomUUID`.
 */
describe("chatSessionId", () => {
  beforeEach(() => {
    // A fresh module per test: the id is cached at module level.
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses randomUUID where the browser has it", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "0b7c4e1a-3f52-4d8e-9a61-2c5f8e7d1b40" });
    const { chatSessionId } = await import("@/lib/chatSession");
    expect(chatSessionId()).toBe("0b7c4e1a-3f52-4d8e-9a61-2c5f8e7d1b40");
  });

  it("falls back to getRandomValues, not Math.random, without randomUUID", async () => {
    const mathRandom = vi.spyOn(Math, "random");
    const getRandomValues = vi.fn((bytes: Uint8Array) => webcrypto.getRandomValues(bytes));
    vi.stubGlobal("crypto", { getRandomValues });
    const { chatSessionId } = await import("@/lib/chatSession");

    const id = chatSessionId();
    // 128 bits, the same entropy as a UUID, and well inside the server's 200-character limit.
    expect(id).toMatch(/^bc-[0-9a-f]{32}$/);
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it("keeps one id for the whole conversation", async () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => webcrypto.getRandomValues(bytes) });
    const { chatSessionId } = await import("@/lib/chatSession");
    expect(chatSessionId()).toBe(chatSessionId());
  });
});
