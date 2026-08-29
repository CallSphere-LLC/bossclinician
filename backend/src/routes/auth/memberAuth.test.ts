import { describe, expect, it } from "vitest";
import { accountBackoffSeconds, accountCooldownRemaining } from "./memberAuth";

/**
 * The account-wide sign-in bound.
 *
 * The per-IP limiter stops one machine at five guesses a window; it cannot see
 * the same five bought forty times over from forty proxies. The account-wide
 * counter can, and what it does about it has to hold four things at once:
 *
 *  1. the real owner, typing the right password, still gets in;
 *  2. a distributed attacker's evaluated guesses are bounded by a constant per
 *     window rather than by five times however many IPs they rent;
 *  3. the wait is the same for an address with an account and one without, so
 *     it cannot be asked whether somebody is a customer here; and
 *  4. nothing sleeps — the refusal is immediate, because a gate that held a
 *     socket open would be a cheaper outage than the attack it prevents.
 *
 * (3) is a property of where the counters come from — `member_login_attempts`
 * is keyed on the address as typed and a failure is recorded for an unknown
 * address exactly as for a known one — so the functions below cannot tell the
 * difference either, and these tests pin the arithmetic that (1), (2) and (4)
 * rest on.
 */

const CEILING = 40;
const CAP_SECONDS = 60;

describe("accountBackoffSeconds", () => {
  it("costs an ordinary person nothing", () => {
    // Somebody who has mistyped their own password all morning is still nowhere
    // near this, and must not be made to wait between attempts.
    expect(accountBackoffSeconds(0)).toBe(0);
    expect(accountBackoffSeconds(5)).toBe(0);
    expect(accountBackoffSeconds(39)).toBe(0);
  });

  it("starts at the ceiling and doubles per further failure", () => {
    expect(accountBackoffSeconds(CEILING)).toBe(5);
    expect(accountBackoffSeconds(CEILING + 1)).toBe(10);
    expect(accountBackoffSeconds(CEILING + 2)).toBe(20);
    expect(accountBackoffSeconds(CEILING + 3)).toBe(40);
  });

  it("caps, so the owner's worst wait is a minute and not a lockout", () => {
    expect(accountBackoffSeconds(CEILING + 4)).toBe(CAP_SECONDS);
    expect(accountBackoffSeconds(CEILING + 10)).toBe(CAP_SECONDS);
    expect(accountBackoffSeconds(1_000)).toBe(CAP_SECONDS);
    // The exponent is driven by a counter an attacker controls; a huge one must
    // still land on the cap rather than on Infinity or NaN.
    expect(accountBackoffSeconds(Number.MAX_SAFE_INTEGER)).toBe(CAP_SECONDS);
  });

  it("holds the attacker below the ceiling they need to keep the gap on", () => {
    // This is the whole argument. At the cap an attacker can have at most one
    // guess evaluated per minute, so inside the fifteen-minute window they can
    // contribute at most fifteen failures — fewer than the forty it takes to be
    // above the ceiling. The counter therefore drains under sustained attack,
    // the gap lapses with it, and the account needs nobody to unlock it.
    const windowMinutes = 15;
    const failuresAnAttackerCanLandPerWindow = (windowMinutes * 60) / CAP_SECONDS;
    expect(failuresAnAttackerCanLandPerWindow).toBeLessThan(CEILING);
  });
});

describe("accountCooldownRemaining", () => {
  const now = new Date("2026-08-18T12:00:00.000Z");
  const secondsAgo = (n: number) => new Date(now.getTime() - n * 1000);

  it("is zero below the ceiling however recent the last failure", () => {
    expect(accountCooldownRemaining(39, secondsAgo(0), now)).toBe(0);
    expect(accountCooldownRemaining(1, secondsAgo(0), now)).toBe(0);
  });

  it("counts down from the last evaluated failure", () => {
    expect(accountCooldownRemaining(CEILING + 5, secondsAgo(0), now)).toBe(CAP_SECONDS);
    expect(accountCooldownRemaining(CEILING + 5, secondsAgo(20), now)).toBe(40);
    expect(accountCooldownRemaining(CEILING + 5, secondsAgo(59), now)).toBe(1);
  });

  it("lapses, so a correct password is eventually evaluated again", () => {
    // The property that separates this from the lockout it replaces: waiting is
    // sufficient, and no reset email — itself rate-limited — is needed.
    expect(accountCooldownRemaining(CEILING + 5, secondsAgo(CAP_SECONDS), now)).toBe(0);
    expect(accountCooldownRemaining(CEILING + 5, secondsAgo(CAP_SECONDS + 600), now)).toBe(0);
  });

  it("never returns a wait longer than the cap", () => {
    // A clock skew between the database and this process must not be able to
    // put a member behind an hour-long wait.
    expect(accountCooldownRemaining(CEILING + 9, secondsAgo(-3600), now)).toBeLessThanOrEqual(
      CAP_SECONDS
    );
  });

  it("treats a missing or unreadable timestamp as no wait", () => {
    // An empty window has no last failure. Failing closed here would refuse
    // everybody on an account nobody has attacked.
    expect(accountCooldownRemaining(CEILING + 5, null, now)).toBe(0);
    expect(accountCooldownRemaining(CEILING + 5, "not a date", now)).toBe(0);
  });

  it("accepts the string a driver may hand back for a timestamp", () => {
    expect(accountCooldownRemaining(CEILING + 5, secondsAgo(30).toISOString(), now)).toBe(30);
  });
});
