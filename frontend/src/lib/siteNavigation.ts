/**
 * The set of destinations the assistants may send a visitor to.
 *
 * Kept as an explicit allow-list rather than letting the model emit an
 * arbitrary path: a hallucinated URL is a dead end, and in a voice conversation
 * the visitor has no address bar to recover with. Anything not in this map is
 * refused and reported back to the model so it can pick again.
 *
 * Mirrors SITE_PAGES in ai/app/services/realtime_service.py, which is what the
 * model actually sees as its tool enum.
 */
export const SITE_PAGES: Record<string, string> = {
  "/": "Home — overview of Boss Clinician and the three offers.",
  "/about": "About Yvette Howard, LCSW — her story and credentials.",
  "/work-with-me": "The coaching offers: the Club, the Lounge, and the Boardroom mastermind.",
  "/courses": "The training library — self-paced courses and toolkits.",
  "/resource-hub": "Free resource hub, including the income calculator.",
  "/resources": "Free resources: the masterclass and the Practice Reset Planner.",
  "/retreats": "Boss Clinician retreats.",
  "/store": "Done-with-you consulting services and their prices.",
  "/practice-reset-planner": "The free 30-day Practice Reset Planner.",
  "/practice-quiz": "The free 2-minute practice quiz.",
  "/blog": "Articles on building a private practice.",
  "/apply": "The application form for working with Yvette.",
  "/contact": "Contact page and booking a call.",
};

export interface ToolResult {
  ok: boolean;
  /** Sent back to the model as the tool output. */
  message: string;
}

/** Normalises a model-supplied path and checks it against the allow-list. */
export function resolvePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let path = raw.trim();
  if (!path) return null;
  // Models sometimes return a full URL or omit the leading slash.
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    return null;
  }
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/+$/, "") || "/";
  return path in SITE_PAGES ? path : null;
}

export function pageCatalogue(): string {
  return Object.entries(SITE_PAGES)
    .map(([path, desc]) => `${path} — ${desc}`)
    .join("\n");
}

/**
 * Runs a tool call from either assistant.
 *
 * `navigate` is injected rather than imported so this stays testable and so the
 * caller decides how routing happens (react-router push vs. full load).
 */
export function runAssistantTool(
  name: string,
  args: Record<string, unknown>,
  navigate: (path: string) => void,
): ToolResult {
  switch (name) {
    case "navigate_to_page": {
      const path = resolvePath(args.path);
      if (!path) {
        return {
          ok: false,
          message: `"${String(args.path)}" is not a page on this site. Choose one of: ${Object.keys(SITE_PAGES).join(", ")}`,
        };
      }
      navigate(path);
      return { ok: true, message: `Opened ${path}. The visitor is now looking at: ${SITE_PAGES[path]}` };
    }
    case "list_site_pages":
      return { ok: true, message: pageCatalogue() };
    default:
      return { ok: false, message: `Unknown tool "${name}".` };
  }
}
