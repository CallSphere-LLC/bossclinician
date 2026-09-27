import { Readable } from "stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../db/pool", () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

import { appendChunk, type UploadSession } from "./resumableUploads";

const finished: UploadSession = {
  id: "00000000-0000-4000-8000-000000000001",
  adminUserId: 1,
  originalName: "lesson.mp4",
  mime: "video/mp4",
  visibility: "public",
  sizeBytes: 10,
  receivedBytes: 10,
  storedName: "lesson.mp4",
  fingerprint: "f",
  status: "open",
  mediaAssetId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  expiresAt: new Date(0).toISOString(),
} as UploadSession;

describe("appendChunk", () => {
  beforeEach(() => query.mockReset().mockResolvedValue({ rows: [] }));

  it("releases the write lock when there is nothing left to write", async () => {
    // The route took the lock before calling; holding it after an empty append
    // would make /complete answer 409 until the lock timed out.
    const result = await appendChunk(finished, 10, Readable.from([]));
    expect(result).toBe(finished);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/SET writing_since = NULL/),
      [finished.id],
    );
  });
});
