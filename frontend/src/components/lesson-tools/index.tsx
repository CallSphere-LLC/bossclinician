import type { ComponentType } from "react";
import { LessonForm } from "@/components/player/LessonForm";
import { BoardroomCeoDashboard } from "./BoardroomCeoDashboard";
import { BossMoveExitPlanner } from "./BossMoveExitPlanner";
import { CustomCalculator, isCalculatorConfig } from "./CustomCalculator";
import { PracticeElevationDashboard } from "./PracticeElevationDashboard";
import { PracticeResetSnapshotTool } from "./PracticeResetSnapshot";
import { PtoSetAsideCalculator } from "./PtoSetAsideCalculator";
import { RampUpRateCalculator } from "./RampUpRateCalculator";
import { RampUpRateComparison } from "./RampUpRateComparison";

/**
 * Interactive tools a lesson can carry, keyed by `course_lessons.tool_key`
 * (migration 104). A key the frontend does not know renders nothing rather
 * than an error, so a lesson never breaks because a tool was renamed.
 *
 * The four dashboards below save each member's entries to their account
 * (migration 119, useToolState.ts) and are attached to their lessons by data
 * in that migration.
 */
export const LESSON_TOOLS: Record<string, ComponentType> = {
  "ramp-up-rate-calculator": RampUpRateCalculator,
  "ramp-up-rate-comparison": RampUpRateComparison,
  "pto-set-aside-calculator": PtoSetAsideCalculator,
  // QA sheet 2026-10-17
  "boss-move-exit-planner": BossMoveExitPlanner, // row 102 — The Boss Move, Lesson 0
  "practice-reset-snapshot": PracticeResetSnapshotTool, // row 101 — Practice Elevation orientation
  "practice-elevation-dashboard": PracticeElevationDashboard, // row 103 — Practice Elevation orientation
  "boardroom-ceo-dashboard": BoardroomCeoDashboard, // row 95 — The Boss Boardroom
};

/**
 * `form-<slug>`: one of the owner's own forms, answered inside the lesson by the
 * signed-in member (migration 112, components/player/LessonForm.tsx).
 */
const LESSON_FORM_PREFIX = "form-";

export function LessonTool({ toolKey, toolConfig }: { toolKey: string | null | undefined; toolConfig?: unknown }) {
  if (toolKey === "custom-calculator") {
    return isCalculatorConfig(toolConfig) ? <CustomCalculator config={toolConfig} /> : null;
  }
  if (toolKey?.startsWith(LESSON_FORM_PREFIX) && toolKey.length > LESSON_FORM_PREFIX.length) {
    return <LessonForm slug={toolKey.slice(LESSON_FORM_PREFIX.length)} />;
  }
  const Tool = toolKey ? LESSON_TOOLS[toolKey] : undefined;
  return Tool ? <Tool /> : null;
}
