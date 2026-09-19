import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
const mocks = vi.hoisted(() => ({ detail: vi.fn(), finalize: vi.fn(), save: vi.fn(), url: vi.fn() }));
vi.mock("../../services/voice/sessionStore", () => ({ sessionDetail: mocks.detail, setSessionRecording: mocks.save, deleteSession: vi.fn(), listSessions: vi.fn() }));
vi.mock("../../services/voice/recordingStore", async (original) => ({
  ...await original<typeof import("../../services/voice/recordingStore")>(),
  recordingStore: () => ({ finalize: mocks.finalize }), recordingStoreFor: () => ({ url: mocks.url }),
}));
import { adminVoiceSessionsRouter } from "./voiceSessions";
import { errorHandler } from "../../middleware/errorHandler";

describe("recording playback finalization boundary", () => {
  let server: ReturnType<express.Express["listen"]>;
  let base: string;
  beforeAll(async () => {
    const app = express();
    app.use(adminVoiceSessionsRouter, errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.finalize.mockResolvedValue({ key: "audio/session.webm", bytes: 1024, contentType: "audio/webm" });
    mocks.url.mockResolvedValue("https://recordings.example.test/signed");
  });
  const detail = (overrides: Record<string, unknown> = {}) => ({ endedAt: null, lastSeenAt: new Date().toISOString(), recordingKey: null, recordingFinalizedAt: null, recordingContentType: "audio/webm", ...overrides });
  it("returns409 while chunks are still arriving without joining or signing anything", async () => {
    mocks.detail.mockResolvedValue(detail());
    const response = await fetch(`${base}/session/recording`);
    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toContain("still being saved");
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.url).not.toHaveBeenCalled();
  });
  it.each([
    { endedAt: new Date().toISOString() },
    { lastSeenAt: new Date(Date.now() - 121_000).toISOString() },
  ])("allows ended or abandoned recordings to finalize: %j", async (overrides) => {
    mocks.detail.mockResolvedValue(detail(overrides));
    const response = await fetch(`${base}/session/recording`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith("session");
    expect(mocks.save).toHaveBeenCalledOnce();
    expect((await response.json() as { contentType: string }).contentType).toBe("audio/webm");
  });
  it("uses a completed recording without finalizing it again", async () => {
    mocks.detail.mockResolvedValue(detail({ endedAt: new Date().toISOString(), recordingKey: "audio/session.webm", recordingFinalizedAt: new Date().toISOString() }));
    expect((await fetch(`${base}/session/recording`)).status).toBe(200);
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.url).toHaveBeenCalledExactlyOnceWith("audio/session.webm");
  });
  it("returns404 for an unknown conversation without touching recordings", async () => {
    mocks.detail.mockResolvedValue(null);
    expect((await fetch(`${base}/missing/recording`)).status).toBe(404);
    expect(mocks.finalize).not.toHaveBeenCalled();
  });
});
