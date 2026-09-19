import { expect, it, vi } from "vitest";
import { decideGreeting } from "./first-visit";
import { PUBLIC_POLICY } from "../surfaces/public";
import type { TourProgress, VoiceContext } from "../contract";

it("offers without navigating, remembers refusal, and invites resumption without starting", async () => {
  let progress: TourProgress | null = null;
  const navigate = vi.fn();
  const post = vi.fn();
  const ctx = { navigate, call: { get: async () => ({ progress }), post } } as unknown as VoiceContext;
  expect(await decideGreeting(PUBLIC_POLICY, ctx)).toMatchObject({ firstVisit: true, greeting: PUBLIC_POLICY.firstVisitGreeting });
  progress = { surface: "public", index: 0, completed: true, updatedAt: Date.now() };
  expect(await decideGreeting(PUBLIC_POLICY, ctx)).toMatchObject({ firstVisit: false, greeting: PUBLIC_POLICY.greeting });
  progress = { ...progress, completed: false, index: 2 };
  expect(await decideGreeting(PUBLIC_POLICY, ctx)).toMatchObject({ firstVisit: false, resumeIndex: 2 });
  expect(navigate).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});
