import { expect, it, vi } from "vitest";
import { buildNavigateTool, buildGoBackTool } from "./navigation";
import { PUBLIC_POLICY } from "../surfaces/public";
import type { VoiceContext } from "../contract";

it("blocks both navigation paths during the unsolicited greeting", async () => {
  const navigate = vi.fn();
  const ctx = { navigate, surface: "public", getUserTurn: () => null } as unknown as VoiceContext;
  const deps = { policy: PUBLIC_POLICY, history: { entries: ["/", "/about"], index: 1 }, onDepart: vi.fn() };
  const identity = (tool: unknown) => tool;
  expect(await buildNavigateTool(identity, ctx, deps).execute({ destination: "about" })).toContain("Stay here");
  expect(await buildGoBackTool(identity, ctx, deps).execute({})).toContain("Stay here");
  expect(navigate).not.toHaveBeenCalled();
});
