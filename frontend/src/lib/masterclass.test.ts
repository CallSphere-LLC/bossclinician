import { describe, expect, it } from "vitest";
import { greetingName, watchNowPath } from "./masterclass";

describe("watchNowPath", () => {
  it("builds the address her Kajabi page used, encoded", () => {
    expect(watchNowPath("Yvette", "yvette@bossclinician.com")).toBe(
      "/watch-now?email=yvette%40bossclinician.com&name=Yvette",
    );
    expect(watchNowPath(" Mary Ann ", "a+b@example.com")).toBe("/watch-now?email=a%2Bb%40example.com&name=Mary+Ann");
  });

  it("drops a blank value rather than sending an empty one", () => {
    expect(watchNowPath("", "")).toBe("/watch-now");
    expect(watchNowPath("Test", "")).toBe("/watch-now?name=Test");
  });
});

describe("greetingName", () => {
  it("greets ordinary first names, in any script", () => {
    for (const name of ["Yvette", "Mary Ann", "Mary-Kate", "D'Andre", "Zoë", "J. R.", "José", "Nguyễn", "李"]) {
      expect(greetingName(name), name).toBe(name);
    }
    expect(greetingName("  Test  ")).toBe("Test");
  });

  it("says nothing when there is no name", () => {
    expect(greetingName(null)).toBeNull();
    expect(greetingName("")).toBeNull();
    expect(greetingName("   ")).toBeNull();
  });

  it("refuses anything that reads as a message, a link or markup", () => {
    for (const crafted of [
      "your account is suspended, call 555-0100",
      "visit evil.example now",
      "evil.example",
      "one two three four",
      "https://evil.example",
      "<script>alert(1)</script>",
      "Test!!",
      "123",
      "a".repeat(41),
      "Anna‮evil",
    ]) {
      const result = greetingName(crafted);
      // The bidi override is stripped, which leaves an ordinary name; anything
      // else here is refused outright.
      if (crafted.includes("‮")) expect(result).toBe("Annaevil");
      else expect(result, crafted).toBeNull();
    }
  });
});
