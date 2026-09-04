import { describe, expect, it } from "vitest";
import {
  MAX_BACKOFF_MS,
  MAX_CHUNK_BYTES,
  MIN_CHUNK_BYTES,
  backoffDelay,
  classifyStatus,
  nextChunkSize,
} from "./retry";

/**
 * These are the decisions that decide whether a 400MB course video finishes on
 * a bad connection or not, and every one of them is only ever exercised when
 * something has already gone wrong. Pinned here so a refactor cannot quietly
 * turn "wait and try again" into "give up".
 */
describe("classifyStatus", () => {
  it("treats a request that got no answer at all as worth retrying", () => {
    // The dropped connection, the sleeping laptop, the tunnel. No response, no
    // status, and the one case the whole resumable path exists for.
    expect(classifyStatus(0)).toBe("retry");
  });

  it("keeps the upload alive when the session expires rather than failing it", () => {
    // The bytes on the server are gone, but the file on her disk is not: the
    // right answer is a new session, not an error message.
    expect(classifyStatus(404)).toBe("restart");
    expect(classifyStatus(410)).toBe("restart");
  });

  it("asks where the file really is when the server disagrees about the offset", () => {
    expect(classifyStatus(409)).toBe("resync");
  });

  it("stops for a sign-in instead of retrying a token that will not improve", () => {
    expect(classifyStatus(401)).toBe("reauth");
    expect(classifyStatus(403)).toBe("reauth");
  });

  it("retries a server having a bad minute, including the proxy ones", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(classifyStatus(status)).toBe("retry");
    }
  });

  it("gives up on refusals that sending the same bytes again cannot fix", () => {
    // A file too large, of the wrong type, or a full disk: retrying is just a
    // slower way to show her the same message.
    for (const status of [400, 413, 415, 422, 501, 507]) {
      expect(classifyStatus(status)).toBe("fatal");
    }
  });
});

describe("backoffDelay", () => {
  it("grows with each attempt and stops growing at the ceiling", () => {
    const steady = () => 0.5;
    expect(backoffDelay(0, steady)).toBe(1000);
    expect(backoffDelay(1, steady)).toBe(2000);
    expect(backoffDelay(3, steady)).toBe(8000);
    // An upload left overnight has to pick itself up in half a minute, not in
    // an hour and a half.
    expect(backoffDelay(20, steady)).toBe(MAX_BACKOFF_MS);
  });

  it("spreads simultaneous retries apart", () => {
    // Four files failing on the same dead network must not all come back at the
    // same instant, or the same one keeps losing.
    expect(backoffDelay(2, () => 0)).toBeLessThan(backoffDelay(2, () => 1));
    expect(backoffDelay(2, () => 0)).toBeGreaterThan(0);
  });
});

describe("nextChunkSize", () => {
  it("halves after a failure, down to a floor a bad line can still carry", () => {
    expect(nextChunkSize(4 * 1024 * 1024, "failed")).toBe(2 * 1024 * 1024);
    expect(nextChunkSize(MIN_CHUNK_BYTES, "failed")).toBe(MIN_CHUNK_BYTES);
  });

  it("grows back after a success, so a big file is not sent in a thousand pieces", () => {
    expect(nextChunkSize(1024 * 1024, "ok")).toBe(2 * 1024 * 1024);
    expect(nextChunkSize(MAX_CHUNK_BYTES, "ok")).toBe(MAX_CHUNK_BYTES);
  });
});
