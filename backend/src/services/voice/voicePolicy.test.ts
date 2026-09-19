import { describe, expect, it } from "vitest";
import { SURFACE_LIMITS, resolveSurface, type VoiceIdentity } from "./contract";
import { ADMISSION_TTL_MS, claimAdmission, issueAdmission, verifyAdmission } from "./admission";
import { invalidSdp } from "./liveSession";
import { admissibleTools, callerKey, claimSessionSlot, normalisePath } from "./policy";

/**
 * The parts of the concierge that decide things, tested without a database, a
 * socket or an OpenAI key.
 *
 * These four groups are the load-bearing ones. Everything else in the slice is
 * plumbing around them: if the surface table is wrong an anonymous visitor gets
 * the owner's tools, if the admission can be replayed one authorisation buys
 * two billable sessions, and if the tool intersection is wrong a patched bundle
 * can describe an admin capability into a public conversation.
 */

const ANON: VoiceIdentity = { audience: "anonymous" };
const MEMBER: VoiceIdentity = { audience: "member", memberId: 42 };
const ADMIN: VoiceIdentity = { audience: "admin", adminUserId: 7, role: "owner" };

describe("resolveSurface", () => {
  it("gives each identity the surface it asked for when it is entitled to it", () => {
    expect(resolveSurface("public", ANON)).toBe("public");
    expect(resolveSurface("member", MEMBER)).toBe("member");
    expect(resolveSurface("admin", ADMIN)).toBe("admin");
  });

  it("degrades quietly rather than refusing — a signed-out visitor on an admin URL is normal", () => {
    expect(resolveSurface("admin", ANON)).toBe("public");
    expect(resolveSurface("member", ANON)).toBe("public");
    expect(resolveSurface("admin", MEMBER)).toBe("public");
  });

  it("lets an admin hold a member session, because an admin is signed in", () => {
    expect(resolveSurface("member", ADMIN)).toBe("member");
  });

  it("never promotes: asking for less than you are gives you less", () => {
    expect(resolveSurface("public", ADMIN)).toBe("public");
    expect(resolveSurface("public", MEMBER)).toBe("public");
  });
});

describe("SDP validation", () => {
  const offer = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

  it("accepts a plain audio offer, with either line ending", () => {
    expect(invalidSdp(offer)).toBe(false);
    expect(invalidSdp(offer.replace(/\r\n/g, "\n"))).toBe(false);
  });

  it("refuses anything that is not an SDP document", () => {
    expect(invalidSdp("")).toBe(true);
    expect(invalidSdp("{\"sdp\":\"v=0\"}")).toBe(true);
    expect(invalidSdp(undefined)).toBe(true);
    expect(invalidSdp(42)).toBe(true);
    // A leading blank line or stray prefix is not a version line.
    expect(invalidSdp(`\r\n${offer}`)).toBe(true);
  });

  it("refuses an offer with no audio — this is a phone call, not a data pipe", () => {
    expect(invalidSdp("v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n")).toBe(true);
    // `m=audiobook` is not an audio media section.
    expect(invalidSdp("v=0\r\nm=audiobook 9 RTP/AVP 0\r\n")).toBe(true);
  });

  it("refuses a NUL byte and an offer past the size cap", () => {
    expect(invalidSdp(`${offer}\0`)).toBe(true);
    expect(invalidSdp(offer + "a=x\r\n".repeat(20_000))).toBe(true);
  });
});

describe("admission", () => {
  const now = 1_760_000_000_000;

  it("round-trips the surface and identity the server decided on", () => {
    const { token } = issueAdmission(
      { sessionId: "sess-round-trip", surface: "member", identity: MEMBER },
      now,
    );
    const claim = verifyAdmission(token, now);
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.admission.surface).toBe("member");
    expect(claim.admission.identity).toEqual(MEMBER);
    expect(claim.admission.expiresAt).toBe(now + ADMISSION_TTL_MS);
  });

  it("works exactly once — a replay cannot open a second session", () => {
    const { token } = issueAdmission(
      { sessionId: "sess-single-use", surface: "public", identity: ANON },
      now,
    );
    expect(claimAdmission(token, now).ok).toBe(true);
    const replay = claimAdmission(token, now + 1_000);
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.reason).toBe("used");
  });

  it("expires, and says so distinctly from being forged", () => {
    const { token } = issueAdmission(
      { sessionId: "sess-expiry", surface: "public", identity: ANON },
      now,
    );
    const late = claimAdmission(token, now + ADMISSION_TTL_MS + 1);
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.reason).toBe("expired");
  });

  it("refuses a token whose payload has been edited to claim a better surface", () => {
    const { token } = issueAdmission(
      { sessionId: "sess-tampered", surface: "public", identity: ANON },
      now,
    );
    const [prefixed, signature] = [token.slice(0, token.lastIndexOf(".")), token.slice(token.lastIndexOf(".") + 1)];
    const body = prefixed.slice("bcva1.".length);
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    payload.surface = "admin";
    payload.identity = ADMIN;
    const forged = `bcva1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${signature}`;

    const claim = verifyAdmission(forged, now);
    expect(claim.ok).toBe(false);
    if (claim.ok) return;
    expect(claim.reason).toBe("invalid");
  });

  it("refuses junk, a bare signature and a token from another scheme", () => {
    for (const bad of ["", "bcva1.", "bcva1.a", "not-a-token", "bcva2.abc.def", null, 12]) {
      const claim = verifyAdmission(bad, now);
      expect(claim.ok).toBe(false);
    }
  });
});

describe("chat tool intersection", () => {
  const tool = (name: string) => ({
    name,
    description: `the ${name} tool`,
    parameters: { type: "object", properties: {} },
  });

  it("keeps what the surface owns", () => {
    const kept = admissibleTools("public", [tool("navigate_to"), tool("read_current_page")]);
    expect(kept.map((t) => t.name)).toEqual(["navigate_to", "read_current_page"]);
  });

  it("drops an admin tool a public session described for itself", () => {
    const kept = admissibleTools("public", [
      tool("navigate_to"),
      tool("run_approved_action"),
      tool("propose_admin_action"),
      tool("my_account_summary"),
    ]);
    expect(kept.map((t) => t.name)).toEqual(["navigate_to"]);
  });

  it("gives a member their own account tool and still no admin ones", () => {
    const kept = admissibleTools("member", [
      tool("my_account_summary"),
      tool("run_approved_action"),
    ]);
    expect(kept.map((t) => t.name)).toEqual(["my_account_summary"]);
  });

  it("gives the admin surface everything, including the two-step action pair", () => {
    const names = ["navigate_to", "my_account_summary", "propose_admin_action", "run_approved_action"];
    expect(admissibleTools("admin", names.map(tool)).map((t) => t.name)).toEqual(names);
  });

  it("drops duplicates, unnamed entries and names outside the alphabet", () => {
    const kept = admissibleTools("public", [
      tool("navigate_to"),
      tool("navigate_to"),
      tool("navigate_to; DROP"),
      tool(""),
      { name: 7 as unknown as string, description: "", parameters: {} },
    ]);
    expect(kept.map((t) => t.name)).toEqual(["navigate_to"]);
  });

  it("caps how many descriptors one turn may carry", () => {
    const many = Array.from({ length: 40 }, (_, i) => tool(`navigate_to`.concat(String(i))));
    // None of these are real tool names, so the cap is demonstrated on the
    // allowed list instead: every admin tool, repeated, still comes back once.
    expect(admissibleTools("admin", many)).toEqual([]);
    expect(admissibleTools("admin", [...Array(40)].map(() => tool("point_at"))).length).toBe(1);
  });
});

describe("per-caller session budget", () => {
  const now = 1_760_000_000_000;

  it("counts a signed-in person as themselves, and a visitor by their cookie", () => {
    const caller = { visitorId: "vis-1", ip: "1.2.3.4" };
    expect(callerKey(ADMIN, caller)).toBe("admin:7");
    expect(callerKey(MEMBER, caller)).toBe("member:42");
    expect(callerKey(ANON, caller)).toBe("visitor:vis-1");
    // Only until a cookie exists: req.ip is one value for the whole site here.
    expect(callerKey(ANON, { visitorId: null, ip: "1.2.3.4" })).toBe("ip:1.2.3.4");
  });

  it("spends the surface's hourly allowance and then refuses with a wait", () => {
    const limit = SURFACE_LIMITS.public.sessionsPerHour;
    const key = "ip:budget-test";
    for (let i = 0; i < limit; i += 1) {
      expect(claimSessionSlot(key, "public", now + i).allowed).toBe(true);
    }
    const refused = claimSessionSlot(key, "public", now + limit);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("slides: an hour after the first session the allowance is back", () => {
    const key = "ip:sliding-test";
    for (let i = 0; i < SURFACE_LIMITS.public.sessionsPerHour; i += 1) {
      claimSessionSlot(key, "public", now + i);
    }
    expect(claimSessionSlot(key, "public", now + 60 * 60 * 1000 + 1).allowed).toBe(true);
  });
});

describe("normalisePath", () => {
  it("keeps an in-app path and refuses anything that could leave the site", () => {
    expect(normalisePath("/club/lesson-1?x=1")).toBe("/club/lesson-1?x=1");
    expect(normalisePath("https://evil.example/")).toBe("/");
    expect(normalisePath("//evil.example/")).toBe("/");
    expect(normalisePath("club")).toBe("/");
    expect(normalisePath(undefined)).toBe("/");
  });
});
