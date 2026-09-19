import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
const fixture = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("../db/pool", () => ({ pool: { connect: async () => fixture, query: fixture.query } }));
import { rotateRefreshToken, setRefreshCookie, signMemberAccessToken } from "./memberSession";

const now = new Date("2026-09-19T12:00:00Z");
const deadline = new Date("2026-09-19T12:05:00Z");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); fixture.query.mockReset(); });
afterEach(() => vi.useRealTimers());
function database(revoked = false, expires = deadline) {
  fixture.query.mockImplementation(async (sql: string) => {
    if (sql.includes("WHERE token_hash = $1")) return { rows: [{ id: 1, member_id: 7, revoked_at: revoked ? now.toISOString() : null, revoked_reason: revoked ? "rotated" : "", expires_at: expires.toISOString() }] };
    if (sql.includes("WHERE previous_id = $1")) return { rows: [{ id: 2 }] };
    return { rows: [] };
  });
}
describe("absolute member session deadline", () => {
  it.each([false, true])("rotation preserves the original expiry, including a concurrent refresh race (%s)", async (race) => {
    database(race);
    expect(await rotateRefreshToken("test-token", {})).toMatchObject({ status: "ok", memberId: 7, expiresAt: deadline.toISOString() });
    const insert = fixture.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO member_sessions"));
    expect(insert?.[1][5]).toEqual(deadline);
  });
  it.each([false, true])("refuses an expired session, including the refresh race (%s)", async (race) => {
    database(race, new Date(now.getTime() - 1000));
    expect(await rotateRefreshToken("test-token", {})).toEqual({ status: "invalid" });
    expect(fixture.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO member_sessions"))).toBe(false);
  });
  it("caps the access JWT and both cookies at the remaining absolute lifetime", () => {
    const token = signMemberAccessToken({ sub: 7, email: "qa@example.test" }, deadline);
    const payload = jwt.decode(token) as { exp: number };
    expect(payload.exp * 1000).toBe(deadline.getTime());
    const cookie = vi.fn();
    setRefreshCookie({ cookie } as never, "test-token", deadline);
    expect(cookie.mock.calls).toHaveLength(2);
    for (const args of cookie.mock.calls) expect(args[2].maxAge).toBe(5 * 60 * 1000);
  });
});
