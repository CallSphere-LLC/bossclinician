import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_DELIVERY_ATTEMPTS,
  REPLAY_TOLERANCE_SECONDS,
  deliveryBackoffSeconds,
  generateSigningSecret,
  isKnownEvent,
  signPayload,
  verifySignature,
} from "./webhooksOut";

/**
 * The signature is the whole security model of an outbound webhook: the
 * receiver has no other way to tell our POST from anybody else's. These tests
 * are written from the integrator's side — they reimplement the documented
 * scheme by hand and check that what we send satisfies it, so the comment in
 * webhooksOut.ts and the code cannot drift apart silently.
 */

const SECRET = "whsec_test_secret";
const BODY = JSON.stringify({ event: "order.paid", data: { id: 7, amountCents: 49700 } });

/** The verification an integrator would write from the documentation. */
function verifyByHand(secret: string, header: string, body: string, now: number): boolean {
  const [tPart, vPart] = header.split(",");
  const timestamp = Number(tPart.replace("t=", ""));
  const presented = vPart.replace("v1=", "");

  if (Math.abs(now - timestamp) > 300) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  return expected === presented;
}

describe("webhook signatures", () => {
  it("produces a header an integrator can verify from the documentation alone", () => {
    const now = 1_718_040_000;
    expect(verifyByHand(SECRET, signPayload(SECRET, BODY, now), BODY, now)).toBe(true);
  });

  it("has the documented shape", () => {
    const header = signPayload(SECRET, BODY, 1_718_040_000);
    expect(header).toMatch(/^t=1718040000,v1=[0-9a-f]{64}$/);
  });

  it("signs the timestamp together with the body", () => {
    // Moving the timestamp has to change the signature, or the header's `t`
    // could be rewritten and a captured request replayed forever.
    const a = signPayload(SECRET, BODY, 1_718_040_000);
    const b = signPayload(SECRET, BODY, 1_718_040_001);
    expect(a.split("v1=")[1]).not.toBe(b.split("v1=")[1]);
  });

  it("accepts its own signature", () => {
    const now = 1_718_040_000;
    const header = signPayload(SECRET, BODY, now);
    expect(verifySignature(SECRET, header, BODY, { atSeconds: now })).toBe(true);
  });

  it("rejects a body that was altered in transit", () => {
    const now = 1_718_040_000;
    const header = signPayload(SECRET, BODY, now);
    const tampered = BODY.replace("49700", "1");
    expect(verifySignature(SECRET, header, tampered, { atSeconds: now })).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const now = 1_718_040_000;
    const header = signPayload("whsec_someone_elses", BODY, now);
    expect(verifySignature(SECRET, header, BODY, { atSeconds: now })).toBe(false);
  });

  it("rejects a replay outside the tolerance and accepts one inside it", () => {
    const signedAt = 1_718_040_000;
    const header = signPayload(SECRET, BODY, signedAt);

    const justInside = signedAt + REPLAY_TOLERANCE_SECONDS - 1;
    const wellOutside = signedAt + REPLAY_TOLERANCE_SECONDS + 60;

    expect(verifySignature(SECRET, header, BODY, { atSeconds: justInside })).toBe(true);
    expect(verifySignature(SECRET, header, BODY, { atSeconds: wellOutside })).toBe(false);
  });

  it("tolerates a receiver clock that is behind ours", () => {
    const signedAt = 1_718_040_000;
    const header = signPayload(SECRET, BODY, signedAt);
    expect(verifySignature(SECRET, header, BODY, { atSeconds: signedAt - 120 })).toBe(true);
  });

  it("rejects a malformed header rather than throwing", () => {
    const now = 1_718_040_000;
    expect(verifySignature(SECRET, "", BODY, { atSeconds: now })).toBe(false);
    expect(verifySignature(SECRET, "garbage", BODY, { atSeconds: now })).toBe(false);
    expect(verifySignature(SECRET, "t=abc,v1=def", BODY, { atSeconds: now })).toBe(false);
    expect(verifySignature(SECRET, `t=${now}`, BODY, { atSeconds: now })).toBe(false);
    // A truncated signature must not pass a length-insensitive comparison.
    const real = signPayload(SECRET, BODY, now).split("v1=")[1];
    expect(
      verifySignature(SECRET, `t=${now},v1=${real.slice(0, 32)}`, BODY, { atSeconds: now })
    ).toBe(false);
  });
});

describe("signing secrets", () => {
  it("are recognisable and unguessable", () => {
    const secret = generateSigningSecret();
    expect(secret.startsWith("whsec_")).toBe(true);
    expect(secret.length).toBeGreaterThan(30);
    expect(secret).not.toBe(generateSigningSecret());
  });
});

describe("retry schedule", () => {
  it("backs off and then stops climbing", () => {
    const waits = [1, 2, 3, 4].map(deliveryBackoffSeconds);
    expect(waits).toEqual([30, 120, 600, 3600]);
    for (let i = 1; i < waits.length; i += 1) expect(waits[i]).toBeGreaterThan(waits[i - 1]);
  });

  it("never asks for a wait beyond the last step, however many attempts are claimed", () => {
    expect(deliveryBackoffSeconds(MAX_DELIVERY_ATTEMPTS)).toBe(3600);
    expect(deliveryBackoffSeconds(99)).toBe(3600);
    expect(deliveryBackoffSeconds(0)).toBe(30);
  });
});

describe("event catalogue", () => {
  it("knows the events the platform emits and nothing else", () => {
    expect(isKnownEvent("order.paid")).toBe(true);
    expect(isKnownEvent("contact.created")).toBe(true);
    expect(isKnownEvent("order.everything")).toBe(false);
  });
});
