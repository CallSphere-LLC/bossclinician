import { describe, expect, it } from "vitest";
import { friendlyError } from "./friendly";

/** The shape `friendlyError` reads off an ApiError: a message and a status. */
function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

describe("friendlyError on a 409", () => {
  it("keeps the server's sentence when the conflict is not a name clash", () => {
    const said = "This file is still being uploaded somewhere else.";
    expect(friendlyError(apiError(409, said), "file")).toBe(said);
  });

  it("falls back to the name-clash sentence for the bare default", () => {
    expect(friendlyError(apiError(409, "Conflict"), "tag")).toBe(
      "That tag clashes with one you already have — try a different name.",
    );
  });

  it("falls back to the name-clash sentence when there is no message", () => {
    expect(friendlyError({ status: 409 }, "tag")).toMatch(/clashes with one you already have/);
  });
});
