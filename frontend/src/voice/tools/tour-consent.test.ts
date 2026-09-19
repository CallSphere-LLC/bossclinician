import { describe, expect, it, vi } from "vitest";
import type { VoiceContext, VoiceSurfacePolicy } from "../contract";
import { buildStartTourTool, buildNextTourStopTool, buildEndTourTool, createTourState, tourIntent } from "./tour";
import { PUBLIC_POLICY } from "../surfaces/public";

vi.mock("./spotlight", () => ({ clearSpotlight: vi.fn(), resolveElement: vi.fn(() => ({})), setSpotlight: vi.fn() }));
vi.mock("./page-reader", () => ({ snapshotToPrompt: () => "Actual visible page" }));
vi.mock("./navigation", () => ({
  resolveDestination: (_: unknown, args: { destination: string }) => ({ ok: true, path: `/${args.destination}`, label: args.destination }),
  travelTo: async (ctx: VoiceContext, _: unknown, destination: { path: string; label: string }) => {
    ctx.navigate(destination.path); return { ...destination, snapshot: {} };
  },
}));

function setup(mode: "text" | "voice") {
  let turn: { id: number; text: string } | null = null;
  const navigate = vi.fn();
  const ctx = { navigate, mode, surface: "public", getLocation: () => "/", getSessionId: () => null, getUserTurn: () => turn,
    call: { get: vi.fn(async () => ({ progress: null })), post: vi.fn(async () => ({})), put: vi.fn(), del: vi.fn() },
  } as unknown as VoiceContext;
  const policy = { ...PUBLIC_POLICY, tour: [
    { destination: "home", purpose: "Home overview", beats: [{ focus: "First", say: "First detail" }, { focus: "Second", say: "Second detail" }] },
    { destination: "about", purpose: "About overview", beats: [] },
  ] } as VoiceSurfacePolicy;
  const state = createTourState();
  const deps = { policy, history: { entries: ["/"], index: 0 }, state };
  const tool = (descriptor: unknown) => descriptor;
  return { ctx, state, navigate, start: buildStartTourTool(tool, ctx, deps), next: buildNextTourStopTool(tool, ctx, deps), end: buildEndTourTool(tool, ctx, deps),
    say: (text: string) => { turn = { id: (turn?.id ?? 0) + 1, text }; } };
}

describe.each(["text", "voice"] as const)("%s tour consent and pacing", (mode) => {
  it("does not navigate on greeting, silence, refusal or a question", async () => {
    const tour = setup(mode);
    await tour.start.execute({});
    for (const text of ["No thanks", "What is the Club?", "Yes but not now"]) {
      tour.say(text); await tour.start.execute({});
    }
    expect(tour.navigate).not.toHaveBeenCalled();
    expect(tour.state.running).toBe(false);
    expect(tour.ctx.call.get).not.toHaveBeenCalled();
  });

  it("starts after yes and permits only one detail per fresh next, including repeated next", async () => {
    const tour = setup(mode);
    tour.say("Yes please");
    expect(await tour.start.execute({})).toContain("Home overview");
    expect(tour.navigate).toHaveBeenCalledTimes(1);
    await tour.next.execute({});
    expect(tour.state.cursor.beatIndex).toBe(0);
    tour.say("What does that mean?"); await tour.next.execute({});
    expect(tour.state.cursor.beatIndex).toBe(0);
    tour.say("Next");
    expect(await tour.next.execute({})).toContain("First detail");
    await tour.next.execute({});
    expect(tour.state.cursor.beatIndex).toBe(1);
    tour.say("Next");
    expect(await tour.next.execute({})).toContain("Second detail");
    expect(tour.navigate).toHaveBeenCalledTimes(1);
    tour.say("Continue"); await tour.next.execute({});
    expect(tour.navigate).toHaveBeenCalledTimes(2);
  });

  it("stops on request and cannot silently restart", async () => {
    const tour = setup(mode);
    tour.say("Show me around"); await tour.start.execute({});
    tour.say("Stop"); await tour.end.execute({});
    await tour.start.execute({}); await tour.next.execute({});
    expect(tour.state.running).toBe(false);
    expect(tour.navigate).toHaveBeenCalledTimes(1);
    tour.say("Start the tour"); await tour.start.execute({});
    expect(tour.state.running).toBe(true);
  });

  it("accepts explicit restart even after an earlier decline", async () => {
    const tour = setup(mode);
    vi.mocked(tour.ctx.call.get).mockResolvedValue({ progress: { surface: "public", index: 0, completed: true, updatedAt: Date.now() } });
    tour.say("Can you show me around?"); await tour.start.execute({});
    expect(tour.navigate).toHaveBeenCalledTimes(1);
  });
});

it("does not mistake unrelated approval or negative answers for tour consent", () => {
  for (const text of ["yes, delete the record", "No, continue answering my question", "Not now", "What is next?"]) expect(tourIntent(text)).toBeNull();
});
