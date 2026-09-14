import { useSyncExternalStore } from "react";

export type SiteTheme = "dark" | "light";
const STORAGE_KEY = "bc_site_theme";
const listeners = new Set<() => void>();
let current: SiteTheme = "dark";

function apply(theme: SiteTheme): void {
  current = theme;
  document.documentElement.dataset.siteTheme = theme;
  listeners.forEach((listener) => listener());
}

function readStoredTheme(): SiteTheme {
  try { return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark"; }
  catch { return "dark"; }
}

/** Apply before hydration; the palette is shared by public and member shells. */
export function initializeSiteTheme(): void {
  apply(readStoredTheme());
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) apply(readStoredTheme());
  });
}

export function setSiteTheme(theme: SiteTheme): void {
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* Still works for this visit. */ }
  apply(theme);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSiteTheme(): SiteTheme {
  return useSyncExternalStore(subscribe, () => current, () => "dark");
}
