import { describe, expect, it } from "vitest";
import {
  VOICE_VISITOR_COOKIE,
  ensureVoiceVisitorId,
  readVoiceVisitorId,
  sessionBelongsTo,
  transcriptLineKey,
  type VoiceCaller,
} from "./sessionStore";

/**
 * The rule that a session id is not a capability.
 *
 * A session id is handed to the browser, appears in the transcript endpoint's
 * body and in the recording endpoint's query string, and ends up in logs. If
 * naming one were enough to write into it, a leaked id would let a stranger put
 * words into somebody else's transcript and pull down the audio of their
 * conversation. So ownership is re-decided on every request, and it is decided
 * here — a pure function, tested exhaustively, rather than a condition copied
 * into three handlers that will drift.
 */

const anonymous = (visitorId: string | null = null): VoiceCaller => ({
  identity: { audience: "anonymous" },
  visitorId,
});
const member = (memberId: number, visitorId: string | null = null): VoiceCaller => ({
  identity: { audience: "member", memberId },
  visitorId,
});
const admin = (adminUserId: number): VoiceCaller => ({
  identity: { audience: "admin", adminUserId, role: "owner" },
  visitorId: null,
});

const VISITOR_A = "a".repeat(32);
const VISITOR_B = "b".repeat(32);

describe("who may touch a conversation", () => {
  it("lets a member back into their own conversation and nobody else's", () => {
    const row = { memberId: 7, adminUserId: null, visitorId: null };
    expect(sessionBelongsTo(row, member(7))).toBe(true);
    expect(sessionBelongsTo(row, member(8))).toBe(false);
    expect(sessionBelongsTo(row, anonymous(VISITOR_A))).toBe(false);
    // Not even the owner of the business: she reads transcripts through the
    // admin API, which is a different door with its own permission.
    expect(sessionBelongsTo(row, admin(1))).toBe(false);
  });

  it("holds an admin's conversation to that one administrator", () => {
    const row = { memberId: null, adminUserId: 3, visitorId: null };
    expect(sessionBelongsTo(row, admin(3))).toBe(true);
    expect(sessionBelongsTo(row, admin(4))).toBe(false);
    expect(sessionBelongsTo(row, member(3))).toBe(false);
    expect(sessionBelongsTo(row, anonymous(VISITOR_A))).toBe(false);
  });

  it("matches an anonymous visitor only on the cookie we minted for them", () => {
    const row = { memberId: null, adminUserId: null, visitorId: VISITOR_A };
    expect(sessionBelongsTo(row, anonymous(VISITOR_A))).toBe(true);
    expect(sessionBelongsTo(row, anonymous(VISITOR_B))).toBe(false);
    expect(sessionBelongsTo(row, anonymous(null))).toBe(false);
  });

  it("keeps the conversation when the visitor signs in half way through it", () => {
    // A real and common shape: someone asks the concierge about pricing, signs
    // up, and the tail of that same conversation flushes with a member token
    // attached. The row still belongs to the browser, and the cookie still
    // proves it is the same browser, so the last thing they said is kept
    // rather than dropped for having been said by a customer.
    const row = { memberId: null, adminUserId: null, visitorId: VISITOR_A };
    expect(sessionBelongsTo(row, member(7, VISITOR_A))).toBe(true);
    expect(sessionBelongsTo(row, member(7, VISITOR_B))).toBe(false);
    expect(sessionBelongsTo(row, member(7, null))).toBe(false);
  });

  it("refuses a row that names nobody, rather than treating it as everyone's", () => {
    const row = { memberId: null, adminUserId: null, visitorId: null };
    expect(sessionBelongsTo(row, anonymous(VISITOR_A))).toBe(false);
    expect(sessionBelongsTo(row, member(7))).toBe(false);
    expect(sessionBelongsTo(row, admin(1))).toBe(false);
  });
});

describe("the visitor cookie", () => {
  it("only accepts a value of the shape we mint", () => {
    const req = (value: unknown) => ({ cookies: { [VOICE_VISITOR_COOKIE]: value } }) as never;
    expect(readVoiceVisitorId(req(VISITOR_A))).toBe(VISITOR_A);
    // Case-folded, because a proxy or a hand-edited cookie can change it and
    // the stored value is always lower case.
    expect(readVoiceVisitorId(req(VISITOR_A.toUpperCase()))).toBe(VISITOR_A);
    for (const junk of ["", "not-a-visitor", "a".repeat(31), "a".repeat(33), 42, null]) {
      expect(readVoiceVisitorId(req(junk))).toBeNull();
    }
    expect(readVoiceVisitorId({} as never)).toBeNull();
  });

  it("mints one that cannot be read by script, and reuses it afterwards", () => {
    const cookies: { name: string; value: string; options: Record<string, unknown> }[] = [];
    const req = { cookies: {} as Record<string, string> };
    const res = {
      cookie(name: string, value: string, options: Record<string, unknown>) {
        cookies.push({ name, value, options });
      },
    };

    const first = ensureVoiceVisitorId(req as never, res as never);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]!.options.httpOnly).toBe(true);
    expect(cookies[0]!.options.sameSite).toBe("lax");

    // Second call in the same request must not mint a second id: the row that
    // was just opened is owned by the first one.
    expect(ensureVoiceVisitorId(req as never, res as never)).toBe(first);
    expect(cookies).toHaveLength(1);
  });
});

describe("a retried transcript flush", () => {
  it("keys a line on its own contents, so the same batch sent twice is one line", () => {
    const line = { role: "user" as const, text: "What does it cost?", atMs: 4200 };
    expect(transcriptLineKey(line)).toBe(transcriptLineKey({ ...line }));
  });

  it("tells apart lines that differ in who said it, when, or what was said", () => {
    const base = { role: "user" as const, text: "yes", atMs: 1000 };
    const keys = new Set([
      transcriptLineKey(base),
      transcriptLineKey({ ...base, role: "agent" }),
      transcriptLineKey({ ...base, atMs: 1001 }),
      transcriptLineKey({ ...base, text: "yes " }),
    ]);
    expect(keys.size).toBe(4);
  });
});
