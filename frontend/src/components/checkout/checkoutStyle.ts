import type { CSSProperties } from "react";
export function checkoutButtonStyle(settings: Record<string, unknown>): CSSProperties {
  const color = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
  const radius = Number(settings.buttonBorderRadius ?? 12);
  return {
    background: color(settings.brandColor) ?? "#c9a46a",
    color: color(settings.buttonLabelColor) ?? "#211829",
    border: color(settings.buttonOutlineColor) ? `2px solid ${color(settings.buttonOutlineColor)}` : "2px solid transparent",
    borderRadius: `${Number.isFinite(radius) ? Math.max(0, Math.min(40, radius)) : 12}px`,
  };
}
