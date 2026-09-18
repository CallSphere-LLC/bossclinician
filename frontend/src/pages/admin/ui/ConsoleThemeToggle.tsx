import { useLayoutEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Console appearance: "Dark" (the original near-black palette, and the default)
 * or "White" (the same console on a light ground). The palettes themselves live
 * in admin-theme.css; this only chooses between them.
 *
 * History, because the stored values outlive the labels: the near-black palette
 * was once labelled "Black" and stored as "black", beside a graphite "Dark"
 * stored as "dark". The graphite step is gone. Both old values now mean the
 * near-black palette, which is what "dark" stores from here on.
 *
 * The choice is written to `<html data-console-theme>` rather than to the shell
 * alone, because portalled layers (the admin Dialog) re-apply `.theme-console`
 * under `<body>`, outside the shell, and would otherwise stay Dark. The
 * attribute does nothing outside a `.theme-console`, so the public site and the
 * member pages are unaffected even after client-side navigation away.
 *
 * The admin is client-rendered only (no SSR payload, see entry-client.tsx), so
 * reading storage in the state initialiser cannot mismatch a server render,
 * and a layout effect applies the attribute before the first paint.
 */

export type ConsoleTheme = "dark" | "light";

const STORAGE_KEY = "bc_admin_theme";

function readStoredTheme(): ConsoleTheme {
  try {
    // Anything but "light" — including the retired "black" and graphite "dark".
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    // Storage blocked (private mode, site data disabled): fall back to default.
    return "dark";
  }
}

const OPTIONS: { value: ConsoleTheme; label: string; swatch: string }[] = [
  { value: "light", label: "White", swatch: "#ffffff" },
  { value: "dark", label: "Dark", swatch: "#08070a" },
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
              "flex h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors sm:h-7 sm:px-2",
              active ? "bg-ink/[0.08] text-ink" : "text-ink-soft hover:text-plum",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-3 shrink-0 rounded-full ring-1",
                active ? "ring-plum" : "ring-ink/25",
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
