/**
 * navigation.ts — how the concierge travels the app while it keeps talking.
 *
 * The catalog of places worth going is NOT owned here: it arrives on the
 * policy, written per surface. What is owned here is the one gate that decides
 * whether a target is navigable at all — `resolveDestination` — and the two
 * tools built on top of it. Keeping the decision in a single pure function is
 * what makes the rule testable without a browser and impossible to bypass by
 * adding another tool later.
 *
 * The refusal is a VALUE, not a thrown error or a bare null, because the agent
 * has to say something when it cannot go somewhere. "I can't open the admin
 * area from here" is a sentence; a null is a stall.
 *
 * Pure at module scope: no `window`, no `document`, no router. The DOM is only
 * touched inside `execute`, which never runs during a server render.
 */

import type {
  ConciergeTool,
  PageSnapshot,
  ToolFn,
  VoiceContext,
  VoiceDestination,
  VoiceSurface,
  VoiceSurfacePolicy,
} from "../contract";
import { readCurrentPage, snapshotToPrompt } from "./page-reader";

/**
 * How long to let a route render before reading it.
 *
 * The agent narrates what the tool result says, so reading the DOM in the same
 * tick as the navigation would describe the page the visitor just left. A beat
 * of settle time costs nothing in a conversation and is the difference between
 * an accurate description and a confidently wrong one.
 */
export const SETTLE_MS = 650;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/*  Which surface a path belongs to                                    */
/* ------------------------------------------------------------------ */

/**
 * The three faces of the app are nested, not parallel: an admin may stand
 * anywhere, a member may stand on the public site, and a visitor may stand only
 * on the public site. Ranking them turns "may this session go there?" into one
 * comparison instead of a table of nine cases.
 */
const SURFACE_RANK: Record<VoiceSurface, number> = { public: 0, member: 1, admin: 2 };

/** Everything under here is behind the admin sign-in (see App.tsx). */
const ADMIN_PREFIXES = ["/admin"] as const;

/**
 * The signed-in half of the customer site, mirroring the `RequireMember` block
 * in App.tsx. It is listed rather than derived because the router is not
 * importable from here — a tool that imported the router would drag React onto
 * the server-render path, which is the one thing this slice must not do.
 */
const MEMBER_PREFIXES = [
  "/account",
  "/library",
  "/downloads",
  "/my-events",
  "/community",
  "/coaching",
  "/podcasts",
  "/newsletters",
  "/partners",
] as const;

function hasPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * The lowest surface that is allowed to stand on this path.
 *
 * Compared in lower case because the router matches routes without regard to
 * case: "/Admin/leads" renders the admin app just as "/admin/leads" does, and a
 * gate that only recognised one spelling would wave the other one through.
 */
export function surfaceForPath(pathname: string): VoiceSurface {
  const normalized = pathname.toLowerCase();
  if (hasPrefix(normalized, ADMIN_PREFIXES)) return "admin";
  if (hasPrefix(normalized, MEMBER_PREFIXES)) return "member";
  return "public";
}

/* ------------------------------------------------------------------ */
/*  The gate                                                           */
/* ------------------------------------------------------------------ */

export type DestinationResolution =
  | {
      ok: true;
      path: string;
      label: string;
      /** One grounded line to lean on after arriving. */
      narration: string;
      /** True when the target came from (or matched) the surface's catalog. */
      known: boolean;
    }
  | {
      ok: false;
      /** Already phrased as something the agent can say out loud. */
      reason: string;
    };

/**
 * Normalise a raw in-app path.
 *
 * Absolute and protocol-relative URLs are refused outright rather than
 * translated: this tool does client-side navigation inside one tab, and the
 * only reason a model would hand it `https://…` is that it has confused this
 * app with the open web. Refusing keeps the contract unambiguous and keeps the
 * function pure — there is no origin to consult and so no `window` to read.
 */
function normalizePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return null;

  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  try {
    // A throwaway base makes the URL parser do the work of collapsing "..",
    // duplicate slashes and stray encoding without any of it reaching a router.
    const parsed = new URL(withSlash, "https://app.invalid");
    let pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
    return `${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/** Loose text → catalog match over keys, labels and aliases. */
function matchByText(
  destinations: readonly VoiceDestination[],
  text: string,
): VoiceDestination | null {
  const q = text.toLowerCase().trim();
  if (!q) return null;
  for (const d of destinations) {
    if (d.key.toLowerCase() === q || d.label.toLowerCase() === q) return d;
    if (d.aliases.some((alias) => alias.toLowerCase() === q)) return d;
  }
  for (const d of destinations) {
    if (d.aliases.some((alias) => q.includes(alias.toLowerCase()))) return d;
    if (q.includes(d.key.toLowerCase())) return d;
  }
  return null;
}

function refusalFor(required: VoiceSurface, surface: VoiceSurface): string {
  if (required === "admin") {
    return "That is inside the private admin area, which isn't part of this visit. Say so plainly and offer one of the pages you do know.";
  }
  if (required === "member" && surface === "public") {
    return "That page is inside a member's own portal and needs them signed in. Say so warmly and offer to show them how to sign in or what is on the public site.";
  }
  return `That page is outside this ${surface} visit. Stay where you are and offer somewhere you can actually go.`;
}

/**
 * The ONE place that decides whether the agent may travel to a target.
 *
 * It takes either a catalog key or a raw in-app path, because a catalog can
 * never list every route of an app this size and a concierge that can only walk
 * to nine places is a menu, not a guide. Both paths through this function end
 * at the same surface check, so opening up raw paths never opened up the admin.
 */
export function resolveDestination(
  policy: VoiceSurfacePolicy,
  input: { destination?: string | null; path?: string | null },
): DestinationResolution {
  const destinations = policy.destinations;

  if (input.destination) {
    const key = input.destination.trim();
    const hit =
      destinations.find((d) => d.key === key) ?? matchByText(destinations, key);
    if (hit) {
      // A destination may be listed on a policy and still be marked for a
      // higher surface; the catalog check and the path check both have to pass.
      if (!hit.surfaces.includes(policy.surface)) {
        return { ok: false, reason: refusalFor(hit.surfaces[0] ?? "admin", policy.surface) };
      }
      const required = surfaceForPath(hit.path);
      if (SURFACE_RANK[required] > SURFACE_RANK[policy.surface]) {
        return { ok: false, reason: refusalFor(required, policy.surface) };
      }
      return { ok: true, path: hit.path, label: hit.label, narration: hit.narration, known: true };
    }
    // Fall through: a model that invents a key often means the path it typed
    // alongside it, and a raw path is still subject to the same surface gate.
  }

  if (input.path) {
    const path = normalizePath(input.path);
    if (!path) {
      return {
        ok: false,
        reason: "That isn't a page of this app — it looks like a link somewhere else. Offer a page you know instead.",
      };
    }
    const pathname = path.split(/[?#]/)[0];
    const required = surfaceForPath(pathname);
    if (SURFACE_RANK[required] > SURFACE_RANK[policy.surface]) {
      return { ok: false, reason: refusalFor(required, policy.surface) };
    }
    const known = destinations.find((d) => d.path === pathname);
    if (known && !known.surfaces.includes(policy.surface)) {
      return { ok: false, reason: refusalFor(known.surfaces[0] ?? "admin", policy.surface) };
    }
    return {
      ok: true,
      path,
      label: known?.label ?? pathname,
      narration: known?.narration ?? "this page — describe what is actually on screen.",
      known: Boolean(known),
    };
  }

  return {
    ok: false,
    reason: "No page was named. Ask where they would like to go, and offer two or three good options.",
  };
}

/** A compact catalog block for a system prompt (key — label: narration). */
export function destinationCatalogForPrompt(policy: VoiceSurfacePolicy): string {
  return policy.destinations.map((d) => `- ${d.key} → ${d.label}: ${d.narration}`).join("\n");
}

/** The catalog keys, for a tool's argument enum. */
export function destinationKeys(policy: VoiceSurfacePolicy): string[] {
  return policy.destinations.map((d) => d.key);
}

/* ------------------------------------------------------------------ */
/*  The guided journey                                                 */
/* ------------------------------------------------------------------ */

/**
 * The pages this call has visited, in order.
 *
 * Browser history is never used for "go back": the entry behind this one can be
 * another site entirely, or a page this session is not allowed to stand on.
 * Everything in this stack already passed `resolveDestination`, so retracing it
 * cannot walk out of the session's surface.
 */
export type GuidedHistory = { entries: string[]; index: number };

export function createGuidedHistory(ctx: VoiceContext): GuidedHistory {
  return { entries: [ctx.getLocation()], index: 0 };
}

function remember(history: GuidedHistory, ctx: VoiceContext, destination: string): void {
  const current = ctx.getLocation();
  // The visitor can click links themselves mid-call. Recording where they
  // actually are before pushing the new entry keeps "go back" honest.
  if (history.entries[history.index] !== current) {
    history.entries = [...history.entries.slice(0, history.index + 1), current];
    history.index = history.entries.length - 1;
  }
  history.entries = [...history.entries.slice(0, history.index + 1), destination];
  history.index = history.entries.length - 1;
}

export type Arrival = {
  path: string;
  label: string;
  narration: string;
  snapshot: PageSnapshot;
};

/**
 * Travel to an already-resolved destination and come back with a fresh read of
 * what landed on screen. Shared by `navigate_to` and the guided tour so the two
 * cannot drift into behaving differently.
 */
export async function travelTo(
  ctx: VoiceContext,
  history: GuidedHistory,
  resolved: Extract<DestinationResolution, { ok: true }>,
  onDepart?: () => void,
): Promise<Arrival> {
  onDepart?.();
  remember(history, ctx, resolved.path);
  ctx.navigate(resolved.path);
  await wait(SETTLE_MS);
  return {
    path: resolved.path,
    label: resolved.label,
    narration: resolved.narration,
    snapshot: readCurrentPage(),
  };
}

/* ------------------------------------------------------------------ */
/*  Tools                                                              */
/* ------------------------------------------------------------------ */

export type NavigationDeps = {
  canNavigate?: () => boolean;
  policy: VoiceSurfacePolicy;
  history: GuidedHistory;
  /** Dropping the pointer before a route change stops it hovering over a
   * page that no longer exists. Injected so navigation need not know the
   * spotlight store exists. */
  onDepart: () => void;
};

export function buildNavigateTool(
  toolFn: ToolFn,
  ctx: VoiceContext,
  deps: NavigationDeps,
): ConciergeTool {
  return toolFn({
    name: "navigate_to",
    description:
      "Take the person to another page of this app while the conversation keeps going — same tab, nothing is interrupted. Use `destination` for one of the known pages, or `path` (starting with \"/\") for anywhere else in the app. When it returns, say in one short sentence where you have taken them and what is there.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        destination: {
          type: "string",
          enum: destinationKeys(deps.policy),
          description: "One of the known pages. Prefer this whenever one fits.",
        },
        path: {
          type: "string",
          description:
            "An in-app path beginning with \"/\", for a page that is not in the list. Ignored when `destination` is given and recognised.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    execute: async (args: { destination?: string; path?: string }) => {
      if (!ctx.getUserTurn?.() || deps.canNavigate?.() === false) return "Stay here. Navigation needs a new explicit user request; do not bypass the guided tour consent or pace. Use the tour tools for a walkthrough.";
      const resolved = resolveDestination(deps.policy, {
        destination: args?.destination,
        path: args?.path,
      });
      if (!resolved.ok) return resolved.reason;

      const arrival = await travelTo(ctx, deps.history, resolved, deps.onDepart);
      return `You have taken them to ${arrival.label} (${arrival.path}). It shows ${arrival.narration}\n\n${snapshotToPrompt(arrival.snapshot)}`;
    },
  }) as ConciergeTool;
}

export function buildGoBackTool(
  toolFn: ToolFn,
  ctx: VoiceContext,
  deps: NavigationDeps,
): ConciergeTool {
  return toolFn({
    name: "go_back",
    description:
      "Return to the previous page of this guided journey, while the conversation keeps going. Use it when they say go back, return, or ask to see what they were looking at before. Describe the page you return to in one short sentence.",
    strict: false,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    execute: async () => {
      if (!ctx.getUserTurn?.() || deps.canNavigate?.() === false) return "Stay here and wait for a new explicit request before navigating.";
      const previous = deps.history.entries[deps.history.index - 1];
      if (!previous) {
        return `This is where the journey started, so there is nothing behind it. Ask where they would like to go next.\n\n${snapshotToPrompt(readCurrentPage())}`;
      }
      // Re-check on the way back: the visitor's session can change mid-call
      // (a sign-out, an expired admin session), and a path that was fine a
      // minute ago may no longer be somewhere this session may stand.
      const resolved = resolveDestination(deps.policy, { path: previous });
      if (!resolved.ok) {
        // Drop the entry rather than stepping onto it, so a second "go back"
        // reaches the page before it instead of refusing the same one twice.
        deps.history.entries.splice(deps.history.index - 1, 1);
        deps.history.index -= 1;
        return `${resolved.reason}\n\n${snapshotToPrompt(readCurrentPage())}`;
      }

      deps.onDepart();
      deps.history.index -= 1;
      ctx.navigate(resolved.path);
      await wait(SETTLE_MS);
      return `You have gone back to ${resolved.label} (${resolved.path}).\n\n${snapshotToPrompt(readCurrentPage())}`;
    },
  }) as ConciergeTool;
}

/* ------------------------------------------------------------------ */
/*  Finding a page by name                                             */
/* ------------------------------------------------------------------ */

type BlogCard = { slug: string; title: string; excerpt: string };
type PublicCourse = { slug: string; title: string; subtitle: string };

/** How many words of a request have to appear in a title for it to be a hit. */
function matchesQuery(query: string, haystack: string): boolean {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2);
  if (words.length === 0) return false;
  const text = haystack.toLowerCase();
  return words.some((word) => text.includes(word));
}

/**
 * search_site — "do you have anything about…".
 *
 * The catalog answers for the pages of the app itself; the published articles
 * and courses answer for its content. Both content endpoints are public, so
 * this behaves the same on every surface, and it returns PATHS so the answer
 * can be followed immediately by `navigate_to` rather than described.
 */
export function buildSearchSiteTool(
  toolFn: ToolFn,
  ctx: VoiceContext,
  deps: Pick<NavigationDeps, "policy">,
): ConciergeTool {
  return toolFn({
    name: "search_site",
    description:
      "Find where something lives: a page of this app, a published article, or a course. Use it when they ask whether there is anything about a subject, or you are not sure which page answers their question. It returns pages you can then take them to.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What they are looking for, in their own words." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (args: { query?: string }) => {
      const query = String(args?.query ?? "").trim();
      if (!query) return "Ask them what they are looking for, in a word or two.";

      const pages = deps.policy.destinations
        .filter(
          (destination) =>
            destination.surfaces.includes(deps.policy.surface) &&
            (matchesQuery(query, destination.label) ||
              matchesQuery(query, destination.aliases.join(" ")) ||
              matchesQuery(query, destination.narration)),
        )
        .slice(0, 5)
        .map((destination) => `${destination.label} (${destination.path}) — ${destination.narration}`);

      const [articles, courses] = await Promise.all([
        ctx.call
          .get<{ items: BlogCard[] }>("/blog?limit=50")
          .then((body) =>
            body.items
              .filter((item) => matchesQuery(query, `${item.title} ${item.excerpt}`))
              .slice(0, 4)
              .map((item) => `Article: "${item.title}" (/blog/${item.slug})`),
          )
          .catch(() => [] as string[]),
        ctx.call
          .get<PublicCourse[]>("/courses")
          .then((list) =>
            list
              .filter((course) => matchesQuery(query, `${course.title} ${course.subtitle}`))
              .slice(0, 4)
              .map((course) => `Course: "${course.title}" (/courses/${course.slug})`),
          )
          .catch(() => [] as string[]),
      ]);

      const found = [...pages, ...articles, ...courses];
      if (found.length === 0) {
        return `Nothing here matches "${query}". Say so honestly, then offer the closest page you do know about.`;
      }
      return `Found for "${query}":\n${found.join("\n")}\n\nOffer the best one or two in a sentence, and take them there with navigate_to if they say yes.`;
    },
  }) as ConciergeTool;
}
