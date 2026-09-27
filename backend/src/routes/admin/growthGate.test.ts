import { describe, expect, it } from "vitest";
import { growthGateFor } from "./index";

describe("growthGateFor", () => {
  it("puts podcasts and newsletters, and their own rows, behind the products permissions", () => {
    for (const path of ["/podcasts", "/podcasts/3", "/podcasts/3/episodes", "/podcasts/3/tokens", "/episodes/9", "/tokens/4", "/newsletters", "/newsletters/2/issues", "/issues/5/send"]) {
      expect(growthGateFor(path)).toBe("products");
    }
  });

  it("keeps coaching on coaching and everything else on marketing", () => {
    expect(growthGateFor("/coaching/sessions")).toBe("coaching");
    expect(growthGateFor("/funnels/1")).toBe("marketing");
    expect(growthGateFor("/automations/1/test")).toBe("marketing");
    expect(growthGateFor("/podcastsish")).toBe("marketing");
  });
});
