import { describe, expect, it, vi } from "vitest";
import { namePair } from "./members";

vi.mock("../../db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../email/mailer", () => ({ sendMail: vi.fn() }));


describe("members name pair", () => {
  it("splits a whole name so the displayed pair is written, not just `name`", () => {
    expect(namePair({ name: "Samantha Jo Fletcher" })).toEqual({
      firstName: "Samantha",
      lastName: "Jo Fletcher",
    });
    expect(namePair({ name: "Cher" })).toEqual({ firstName: "Cher", lastName: "" });
  });

  it("keeps the halves the caller sent", () => {
    expect(namePair({ name: "Ignored Whole", firstName: "Ann" })).toEqual({
      firstName: "Ann",
      lastName: "",
    });
  });

  it("leaves both empty when no name was given, so an upsert never blanks one", () => {
    expect(namePair({})).toEqual({ firstName: "", lastName: "" });
    expect(namePair({ name: "" })).toEqual({ firstName: "", lastName: "" });
  });
});
