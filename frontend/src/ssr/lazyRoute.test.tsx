import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { lazyRoute } from "./lazyRoute";
describe("route preload", () => {
  it("shares concurrent and completed imports and renders preloaded content", async () => {
    const factory = vi.fn(async () => ({ default: () => <h1>Course content</h1> }));
    const Page = lazyRoute(factory);
    await Promise.all([Page.preload(), Page.preload()]);
    await Page.preload();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(renderToString(<Page />)).toContain("Course content");
  });
  it("does not cache a failed speculative preload", async () => {
    const factory = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ default: () => <h1>Ready</h1> });
    const Page = lazyRoute(factory);
    await expect(Page.preload()).rejects.toThrow("Offline");
    await Page.preload();
    expect(renderToString(<Page />)).toContain("Ready");
  });
});
