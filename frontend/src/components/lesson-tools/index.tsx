import type { ComponentType } from "react";
import { PtoSetAsideCalculator } from "./PtoSetAsideCalculator";
import { RampUpRateCalculator } from "./RampUpRateCalculator";
import { RampUpRateComparison } from "./RampUpRateComparison";

/**
 * Interactive tools a lesson can carry, keyed by `course_lessons.tool_key`
 * (migration 104). A key the frontend does not know renders nothing rather
 * than an error, so a lesson never breaks because a tool was renamed.
 */
export const LESSON_TOOLS: Record<string, ComponentType> = {
  "ramp-up-rate-calculator": RampUpRateCalculator,
  "ramp-up-rate-comparison": RampUpRateComparison,
  "pto-set-aside-calculator": PtoSetAsideCalculator,
};

export function LessonTool({ toolKey }: { toolKey: string | null | undefined }) {
  const Tool = toolKey ? LESSON_TOOLS[toolKey] : undefined;
  return Tool ? <Tool /> : null;
}
