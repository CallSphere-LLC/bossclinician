import { describe, expect, it } from "vitest";
import { claimRouteRecovery } from "./routeRecovery";
const failure = new TypeError("Failed to fetch dynamically imported module: /assets/Club-old.js");
function storage() { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } }; }
describe("route-load recovery", () => {
  it("recovers a missing chunk once and prevents a refresh loop", () => {
    const tab = storage();
    expect(claimRouteRecovery(failure, "/club", tab, 1000)).toBe(true);
    expect(claimRouteRecovery(failure, "/club", tab, 1001)).toBe(false);
    expect(claimRouteRecovery(failure, "/club", tab, 61001)).toBe(true);
  });
  it("does not reload for application errors or inaccessible storage", () => {
    expect(claimRouteRecovery(new Error("Invalid course"), "/club", storage())).toBe(false);
    expect(claimRouteRecovery(failure, "/club", { getItem() { throw new Error("blocked"); }, setItem() {} })).toBe(false);
  });
  it("allows a different destination to recover independently", () => {
    const tab = storage();
    claimRouteRecovery(failure, "/club", tab, 1000);
    expect(claimRouteRecovery(failure, "/courses", tab, 1001)).toBe(true);
  });
});
