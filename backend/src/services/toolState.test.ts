import { describe, expect, it } from "vitest";
import { MAX_TOOL_STATE_BYTES, cleanToolKey, toolStateProblem } from "./toolState";

describe("member tool state", () => {
  it("accepts the tool keys lessons carry and nothing else", () => {
    expect(cleanToolKey("boss-move-exit-planner")).toBe("boss-move-exit-planner");
    expect(cleanToolKey("practice-reset-snapshot")).toBe("practice-reset-snapshot");
    expect(cleanToolKey("../etc")).toBeNull();
    expect(cleanToolKey("Upper")).toBeNull();
    expect(cleanToolKey("trailing-")).toBeNull();
    expect(cleanToolKey(42)).toBeNull();
    expect(cleanToolKey("x".repeat(121))).toBeNull();
  });

  it("saves only plain objects", () => {
    expect(toolStateProblem({ living: 3800, checks: { fin1: true } })).toBeNull();
    expect(toolStateProblem({})).toBeNull();
    expect(toolStateProblem(null)).not.toBeNull();
    expect(toolStateProblem([1, 2])).not.toBeNull();
    expect(toolStateProblem("text")).not.toBeNull();
    expect(toolStateProblem(undefined)).not.toBeNull();
  });

  it("refuses a document over 256 KB", () => {
    expect(toolStateProblem({ notes: "a".repeat(MAX_TOOL_STATE_BYTES - 100) })).toBeNull();
    expect(toolStateProblem({ notes: "a".repeat(MAX_TOOL_STATE_BYTES) })).not.toBeNull();
    // Measured in bytes, not characters: multi-byte text counts for what it weighs.
    expect(toolStateProblem({ notes: "é".repeat(MAX_TOOL_STATE_BYTES / 2) })).not.toBeNull();
  });
});
