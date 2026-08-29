import { describe, it, expect } from "vitest";
import { BroadcastRefusal, audiencePredicate, variantFor } from "./broadcasts";

/**
 * Only the pure half is unit tested here. Resolving an audience and fanning a
 * send out are SQL and a queue, and are covered against a real database.
 */
describe("audiencePredicate", () => {
  it("answers with a predicate for every key the admin can choose", () => {
    for (const key of [
      "all_contacts",
      "all_subscribers",
      "all_members",
      "leads",
      "community",
      "customers",
    ]) {
      expect(audiencePredicate(key)).toBeTruthy();
    }
  });

  it("refuses an unknown key rather than falling back to everybody", () => {
    // The fallback this replaced was `all_subscribers`, so a campaign whose
    // audience column held a value nothing recognised — the state a segment
    // being deleted leaves behind — was sent to the entire list.
    expect(audiencePredicate("")).toBeNull();
    expect(audiencePredicate("segment")).toBeNull();
    expect(audiencePredicate("all_subscibers")).toBeNull();
  });

  it("does not answer with anything off Object's prototype", () => {
    // Otherwise `audience = "toString"` resolves to a function and is
    // interpolated straight into the WHERE clause.
    for (const key of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      expect(audiencePredicate(key)).toBeNull();
    }
  });
});

describe("BroadcastRefusal", () => {
  it("is an Error the send route can tell apart from a fault", () => {
    // The route shows a refusal's own words to the person sending and hides
    // everything else behind "something went wrong on our end". That rests on
    // `instanceof`, so a refactor back to a plain Error would quietly start
    // printing raw Postgres messages at the owner again.
    const refusal = new BroadcastRefusal("Add a subject line before sending");
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).toBeInstanceOf(BroadcastRefusal);
    expect(new Error("duplicate key value")).not.toBeInstanceOf(BroadcastRefusal);
    expect(refusal.message).toBe("Add a subject line before sending");
  });
});

describe("variantFor", () => {
  it("is stable for the same address, so a retry does not move the arm", () => {
    const first = variantFor("reader@example.com", 50);
    for (let i = 0; i < 5; i += 1) {
      expect(variantFor("reader@example.com", 50)).toBe(first);
    }
  });

  it("puts everybody in A when there is no split", () => {
    expect(variantFor("reader@example.com", 0)).toBe("a");
  });
});
