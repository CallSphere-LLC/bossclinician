import { useLayoutEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Console appearance: "Black" (the original near-black palette, and the
 * default) or "Dark" (a lighter graphite step). The palettes themselves live in
 * admin-theme.css; this only chooses between them.
 *
 * The choice is written to `<html data-console-theme>` rather than to the shell
 * alone, because portalled layers (the admin Dialog) re-apply `.theme-console`
 * under `<body>`, outside the shell, and would otherwise stay Black. The
 * attribute does nothing outside a `.theme-console`, so the public site and the
 * member pages are unaffected even after client-side navigation away.
 *
 * The admin is client-rendered only (no SSR payload, see entry-client.tsx), so
 * reading storage in the state initialiser cannot mismatch a server render,
 * and a layout effect applies the attribute before the first paint.
 */

export type ConsoleTheme = "black" | "dark";

const STORAGE_KEY = "bc_admin_theme";

function readStoredTheme(): ConsoleTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "black";
  } catch {
    // Storage blocked (private mode, site data disabled): fall back to default.
    return "black";
  }
}

const OPTIONS: { value: ConsoleTheme; label: string; swatch: string }[] = [
  { value: "dark", label: "Dark", swatch: "#1a1a1f" },
  { value: "black", label: "Black", swatch: "#000000" },
];

export function ConsoleThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<ConsoleTheme>(readStoredTheme);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.consoleTheme = theme;
    return () => {
      delete root.dataset.consoleTheme;
    };
  }, [theme]);

  function choose(next: ConsoleTheme) {
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }

  return (
    <div
      role="group"
      aria-label="Console appearance"
      className={cn("flex items-center gap-0.5 rounded-xl border border-hairline p-[3px]", className)}
    >
      {OPTIONS.map((option) => {
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            aria-pressed={active}
            aria-label={`${option.label} appearance`}
            title={`${option.label} appearance`}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors",
              active ? "bg-white/[0.08] text-ink" : "text-ink-soft hover:text-plum",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-3 shrink-0 rounded-full ring-1",
                active ? "ring-gold/70" : "ring-white/25",
              )}
              style={{ backgroundColor: option.swatch }}
            />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
