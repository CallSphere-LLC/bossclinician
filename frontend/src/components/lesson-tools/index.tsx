import type { ComponentType } from "react";
import { LessonForm } from "@/components/player/LessonForm";
import { CustomCalculator, isCalculatorConfig } from "./CustomCalculator";
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
