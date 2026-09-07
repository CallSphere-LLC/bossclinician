import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Console theming — Part II §6.
 *
 * Three states, not two. "System" is a real setting that keeps tracking the
 * machine after it is chosen, so a laptop that flips to dark at sunset flips
 * the console with it; it is not a one-off read of the media query at boot.
 *
 * Two things here are deliberate and easy to get wrong:
 *
 * 1. The class goes on <html>, not on the console shell. Radix renders every
 *    dropdown, dialog and drawer through a portal attached to <body>, which is
 *    *outside* any shell element — a theme class on the shell leaves every
 *    popover resolving its tokens from `:root`, i.e. painted in the marketing
 *    site's light palette while the page behind it is charcoal.
 *
 * 2. The stored value is the *preference* ("system"), never the resolved
 *    theme. Storing the resolved value freezes whatever the machine happened
 *    to be at the moment of the click, and "System" silently stops following.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "bc_admin_theme";
const CLASS_DARK = "theme-console";
const CLASS_LIGHT = "theme-console-light";

function isPreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** The stored preference, or "system" when there is nothing usable stored. */
export function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isPreference(raw) ? raw : "system";
  } catch {
    // Private mode, or storage disabled by policy. A themeless console is
    // still a working console; a thrown error during render is not.
    return "system";
  }
}

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface ThemeContextValue {
  /** What the operator chose. */
  preference: ThemePreference;
  /** What that resolves to right now — never "system". */
  theme: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ConsoleThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  // Keep following the machine while the preference is "system". The listener
  // is attached unconditionally rather than only under "system" so that
  // switching back to it is instantly correct instead of correct-on-next-change.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    // The query may have flipped between the initial state and this effect.
    setSystem(query.matches ? "dark" : "light");
    return () => query.removeEventListener("change", onChange);
  }, []);

  const theme: ResolvedTheme = preference === "system" ? system : preference;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.add(theme === "dark" ? CLASS_DARK : CLASS_LIGHT);
    root.classList.remove(theme === "dark" ? CLASS_LIGHT : CLASS_DARK);
    // Leaving the admin for the marketing site must not leave its palette
    // behind — the public pages resolve their tokens from `:root`.
    return () => root.classList.remove(CLASS_DARK, CLASS_LIGHT);
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies for this session; it just will not survive
      // a reload. Not worth surfacing.
    }
  }, []);

  const value = useMemo(
    () => ({ preference, theme, setPreference }),
    [preference, theme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Read the console theme.
 *
 * Falls back to a working dark default outside the provider rather than
 * throwing: a chart that renders in the wrong palette is a blemish, and a
 * hook that throws in a component someone reuses on a public page is an
 * outage.
 */
export function useConsoleTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  return { preference: "system", theme: "dark", setPreference: () => undefined };
}

/**
 * The pre-hydration script.
 *
 * React cannot set the class until it has mounted, which is one paint too
 * late: the console would flash the light marketing palette before settling
 * on charcoal. This runs synchronously in <head> and does the same resolution
 * the provider does, so the first paint is already correct.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{
var p=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
if(p!=="light"&&p!=="dark"&&p!=="system")p="system";
var d=p==="dark"||(p==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);
if(location.pathname.indexOf("/admin")===0)document.documentElement.classList.add(d?${JSON.stringify(CLASS_DARK)}:${JSON.stringify(CLASS_LIGHT)});
}catch(e){}})();`;
