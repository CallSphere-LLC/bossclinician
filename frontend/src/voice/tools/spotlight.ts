/**
 * spotlight.ts — the cursor the concierge points with.
 *
 * When the agent says "this figure here", something on the page has to move,
 * or the sentence is a lie. This module resolves a human phrase to a real
 * element, scrolls it into view and publishes where the cursor should rest.
 * It does not dim, frame or cut out anything: the page stays fully readable and
 * fully usable while the guide talks over it, exactly like a person sharing
 * their screen and hovering their mouse.
 *
 * SHAPE — a dependency-free store plus a pure placement strategy:
 *   • The store publishes a `SpotlightState` (a viewport rect, a label and an
 *     optional caption) and the UI consumes it through `useSyncExternalStore`.
 *     Tracking the rect here rather than in the component is deliberate: the
 *     target moves when the page scrolls, when a layout settles and while the
 *     scroll-into-view animation runs, and only one loop should be watching it.
 *   • `pointerAnchor` is a pure function of rect and viewport, so where the
 *     cursor rests is a rule that can be read and tested without a browser.
 *
 * The same store serves both transports. A typed conversation moves the cursor
 * exactly as a spoken one does — only the wording of the tool result differs.
 *
 * Nothing here touches the DOM at import time.
 */

import {
  NARRATE_ATTR,
  NARRATE_LABEL_ATTR,
  NARRATE_SKIP_ATTR,
  type ConciergeTool,
  type ToolFn,
  type VoiceContext,
} from "../contract";

/* ------------------------------------------------------------------ */
/*  Where the cursor rests — pure                                      */
/* ------------------------------------------------------------------ */

export type PointerRect = { top: number; left: number; width: number; height: number };
export type Viewport = { width: number; height: number };

export type PointerAnchor = {
  /** Viewport coordinates of the cursor tip. */
  x: number;
  y: number;
  /** Which side of the tip the caption pill sits on. */
  captionSide: "right" | "left";
};

/** How far below a target's top edge the tip rests on tall targets. */
const TIP_MAX_DEPTH = 36;
/** Keeps the whole glyph, and the ping around it, inside the viewport. */
const EDGE_MARGIN = 12;
const CURSOR_SIZE = 28;
/** How far the caption pill sits from the tip before its own width counts. */
const CAPTION_OFFSET = 26;

/**
 * How wide the caption pill may grow.
 *
 * A function of the viewport rather than a constant, because a pill sized for a
 * desktop is most of a phone's screen: it must stay narrow enough to fit beside
 * the cursor on a small screen, and wide enough to be worth reading on a tiny
 * one. The overlay styles the pill's `max-width` from this same rule, so what
 * the placement assumes and what the page draws cannot drift apart.
 */
export function captionWidth(viewport: Viewport): number {
  return Math.min(256, Math.max(140, viewport.width - 32));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Rest the tip on the target's horizontal centre, near its top.
 *
 * A heading, a card title or a button label is where the eye should land, and a
 * cursor parked in the middle of a tall card sits on top of the body copy the
 * person is being asked to read. The caption flips to the left when the pill
 * would not fit beside the tip, measured against the width that pill is
 * actually allowed on this screen rather than a desktop-sized guess.
 */
export function pointerAnchor(rect: PointerRect, viewport: Viewport): PointerAnchor {
  const x = clamp(
    rect.left + rect.width / 2,
    EDGE_MARGIN,
    viewport.width - EDGE_MARGIN - CURSOR_SIZE,
  );
  const y = clamp(
    rect.top + Math.min(rect.height / 2, TIP_MAX_DEPTH),
    EDGE_MARGIN,
    viewport.height - EDGE_MARGIN - CURSOR_SIZE,
  );
  const captionSide: PointerAnchor["captionSide"] =
    x + CAPTION_OFFSET + captionWidth(viewport) > viewport.width ? "left" : "right";
  return { x, y, captionSide };
}

/* ------------------------------------------------------------------ */
/*  The store                                                          */
/* ------------------------------------------------------------------ */

/** What the overlay renders. `null` means the cursor is not on screen. */
export type SpotlightState = {
  rect: { top: number; left: number; width: number; height: number };
  label: string;
  caption: string | null;
} | null;

/** How long a pointer stays put with nothing new to say before it fades. */
const IDLE_CLEAR_MS = 14_000;
/** Sub-pixel jitter is not movement; republishing on it would re-render the
 * overlay sixty times a second for nothing. */
const RECT_EPSILON = 0.5;

let element: HTMLElement | null = null;
let currentLabel = "";
let currentCaption: string | null = null;
let snapshot: SpotlightState = null;
let suppressed = false;
let rafId = 0;
let idleTimer = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeSpotlight(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The published state. Stable between changes, as `useSyncExternalStore` requires. */
export function getSpotlightSnapshot(): SpotlightState {
  return snapshot;
}

/** Pointing is a client-only act, so the server always renders nothing. */
export function getSpotlightServerSnapshot(): SpotlightState {
  return null;
}

function stopTracking(): void {
  if (rafId && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
  rafId = 0;
  if (idleTimer && typeof clearTimeout === "function") clearTimeout(idleTimer);
  idleTimer = 0;
}

export function clearSpotlight(): void {
  stopTracking();
  element = null;
  currentLabel = "";
  currentCaption = null;
  if (snapshot === null) return;
  snapshot = null;
  emit();
}

function publish(rect: PointerRect): void {
  const previous = snapshot;
  const moved =
    !previous ||
    Math.abs(previous.rect.top - rect.top) > RECT_EPSILON ||
    Math.abs(previous.rect.left - rect.left) > RECT_EPSILON ||
    Math.abs(previous.rect.width - rect.width) > RECT_EPSILON ||
    Math.abs(previous.rect.height - rect.height) > RECT_EPSILON ||
    previous.label !== currentLabel ||
    previous.caption !== currentCaption;
  if (!moved) return;
  snapshot = { rect, label: currentLabel, caption: currentCaption };
  emit();
}

function track(): void {
  const target = element;
  if (!target) return;
  // A route change, a closed dialog or a re-rendered list detaches the node.
  // Noticing it here is also how the pointer disappears when the visitor
  // navigates by hand mid-call, which no tool would otherwise hear about.
  if (!target.isConnected) {
    clearSpotlight();
    return;
  }
  const rect = target.getBoundingClientRect();
  publish({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
  rafId = requestAnimationFrame(track);
}

/**
 * While a full-screen call UI covers the page there is nothing to point at, and
 * a cursor drawn above that veil reads as a glitch. The overlay owns the flag,
 * because it is the only thing that knows it is covering the page; the store
 * simply goes inert for readers and writers alike while it is set.
 */
export function setSpotlightSuppressed(next: boolean): void {
  if (suppressed === next) return;
  suppressed = next;
  if (next) clearSpotlight();
}

export function isSpotlightSuppressed(): boolean {
  return suppressed;
}

/** Point at an element. Returns false when there is nothing to point at. */
export function setSpotlight(
  el: HTMLElement | null,
  options?: { label?: string; caption?: string | null },
): boolean {
  if (suppressed || typeof window === "undefined") return false;
  if (!el || !el.isConnected) {
    clearSpotlight();
    return false;
  }

  stopTracking();
  element = el;
  currentLabel = (options?.label ?? authoredLabel(el) ?? "").slice(0, 80);
  currentCaption = options?.caption ? options.caption.slice(0, 40) : null;

  try {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  } catch {
    // Older engines reject the options object rather than ignoring it.
    el.scrollIntoView();
  }

  track();
  idleTimer = window.setTimeout(clearSpotlight, IDLE_CLEAR_MS);
  return true;
}

/** Change the caption without moving the cursor. */
export function setSpotlightCaption(caption: string | null): void {
  if (!element) return;
  currentCaption = caption ? caption.slice(0, 40) : null;
  const rect = element.getBoundingClientRect();
  publish({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
}

/* ------------------------------------------------------------------ */
/*  Resolving a human phrase to an element                             */
/* ------------------------------------------------------------------ */

const FOCUS_SELECTOR = [
  `[${NARRATE_LABEL_ATTR}]`,
  `[${NARRATE_ATTR}]`,
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "[role='heading']",
  "button",
  "a",
  "label",
  "dt",
  "dd",
  "th",
  "td",
  "li",
  "p",
  "article",
  "section",
  "[role='button']",
  "[role='tab']",
  "[role='menuitem']",
].join(",");

/**
 * A unit the guide should point at AS A WHOLE — a plan card, a stat tile, the
 * booking calendar. Authored with `data-narrate` on the container, which is the
 * same markup that tells the page reader "this is worth narrating".
 */
const FOCUS_GROUP_SELECTOR = `[${NARRATE_LABEL_ATTR}],[${NARRATE_ATTR}]`;

/**
 * Elements that already name themselves precisely: something the person can act
 * on, or something the author labelled in its own right. Anything else inside a
 * group — a bare title, a price, a sub-heading — is a fragment of the group
 * rather than a destination of its own.
 */
const SELF_SUFFICIENT_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[role='tab']",
  "[role='menuitem']",
  `[${NARRATE_LABEL_ATTR}]`,
  `[${NARRATE_ATTR}]`,
].join(",");

const STOP_WORDS = new Set([
  "a", "about", "all", "an", "and", "are", "as", "at", "be", "can", "could",
  "discuss", "do", "each", "everything", "for", "from", "give", "go", "i", "in",
  "into", "is", "it", "look", "me", "my", "now", "of", "on", "one", "open", "our",
  "page", "please", "point", "screen", "see", "show", "so", "some", "tell",
  "that", "the", "their", "this", "through", "to", "us", "want", "what", "where",
  "which", "with", "would", "you", "your", "focus", "highlight", "spotlight",
]);

/**
 * Words people use for the same thing on this site. A person asks for "my
 * receipt" and the button says "Invoice"; without this the pointer simply never
 * moves, which is worse than pointing at something adjacent.
 */
const TOKEN_ALIASES: Record<string, string[]> = {
  cost: ["price", "pricing", "plan"],
  price: ["cost", "pricing", "plan"],
  pricing: ["cost", "price", "plan"],
  receipt: ["invoice", "purchase", "order"],
  invoice: ["receipt", "bill", "order"],
  purchase: ["order", "receipt", "purchases"],
  order: ["purchase", "receipt", "orders"],
  course: ["courses", "program", "training", "library"],
  courses: ["course", "programs", "library"],
  lesson: ["lessons", "module", "video"],
  library: ["courses", "shelf", "learning"],
  member: ["members", "customer", "people", "contact"],
  contact: ["contacts", "people", "person"],
  enquiry: ["lead", "leads", "enquiries", "message"],
  lead: ["enquiry", "leads", "enquiries"],
  menu: ["navigation", "sidebar", "nav"],
  nav: ["menu", "navigation", "sidebar"],
  sidebar: ["menu", "navigation", "nav"],
  booking: ["calendar", "schedule", "appointment", "session"],
  session: ["booking", "appointment", "call", "coaching"],
  calendar: ["booking", "schedule", "availability"],
  revenue: ["sales", "income", "earnings", "money"],
  sales: ["revenue", "orders", "income"],
};

function normalizeFocusText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$%+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value: string): string[] {
  return Array.from(
    new Set(
      normalizeFocusText(value)
        .split(" ")
        .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
    ),
  );
}

export type FocusTextCandidate = {
  label?: string;
  text: string;
  /** True when an author tagged this element, rather than us inferring it. */
  authored?: boolean;
};

/**
 * Rank one candidate against a natural-language request.
 *
 * Pure, and exported, because "does "the revenue tile" match this element?" is
 * the whole contract of pointing and it deserves to be checked without a DOM.
 */
export function scoreFocusText(query: string, candidate: FocusTextCandidate): number {
  const queryTokens = meaningfulTokens(query);
  if (queryTokens.length === 0) return 0;

  const label = normalizeFocusText(candidate.label ?? "");
  const body = normalizeFocusText(candidate.text);
  const haystack = `${label} ${body}`.trim();
  if (!haystack) return 0;
  const candidateTokens = new Set(haystack.split(" "));
  const corePhrase = queryTokens.join(" ");

  let matched = 0;
  let aliased = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      matched += 1;
      continue;
    }
    if ((TOKEN_ALIASES[token] ?? []).some((alias) => candidateTokens.has(alias))) aliased += 1;
  }
  if (matched === 0 && aliased === 0) return 0;

  let score = matched * 22 + aliased * 8;
  score += ((matched + aliased * 0.45) / queryTokens.length) * 44;
  if (label && label === corePhrase) score += 130;
  else if (corePhrase.length >= 4 && label.includes(corePhrase)) score += 85;
  else if (label.length >= 4 && corePhrase.includes(label)) score += 70;
  else if (corePhrase.length >= 4 && body.includes(corePhrase)) score += 55;
  if (candidate.authored) score += 18;

  // Prefer the specific row over the whole section that contains it. The
  // penalty is gentle on purpose: a card should still beat one of its own
  // children when the request names the card.
  score -= Math.min(24, Math.max(0, haystack.length - 90) / 28);
  return score;
}

/**
 * Should a match inside an authored group widen to the whole group?
 *
 * Yes when the request adds nothing beyond the group's own identity ("the
 * revenue tile" means the tile, not the number inside it), and yes when the
 * matched node is an incidental fragment. No when the request named something
 * more specific that stands on its own — a button keeps its own tight pointer.
 */
export function shouldEscalateToFocusGroup(
  query: string,
  groupLabel: string,
  match: { selfSufficient: boolean },
): boolean {
  const groupTokens = new Set(meaningfulTokens(groupLabel));
  const residual = meaningfulTokens(query).filter((token) => !groupTokens.has(token));
  if (residual.length === 0) return true;
  return !match.selfSufficient;
}

function authoredLabel(el: HTMLElement): string {
  return (
    el.getAttribute(NARRATE_LABEL_ATTR) ||
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

function isVoiceChrome(el: HTMLElement): boolean {
  return Boolean(
    el.closest(`[data-voice-controls],[${NARRATE_SKIP_ATTR}],[aria-hidden='true']`),
  );
}

function isOnScreen(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  // Below-the-fold content often waits at opacity:0 for a scroll-reveal. It is
  // still a valid target — scrolling to it is what triggers the reveal.
  return style.display !== "none" && style.visibility !== "hidden";
}

function escalateToFocusGroup(el: HTMLElement, query: string): HTMLElement {
  const group = el.closest<HTMLElement>(FOCUS_GROUP_SELECTOR);
  if (!group || group === el) return el;
  const groupLabel = authoredLabel(group) || (group.getAttribute(NARRATE_ATTR) ?? "").trim();
  if (!groupLabel) return el;
  return shouldEscalateToFocusGroup(query, groupLabel, {
    selfSufficient: el.matches(SELF_SUFFICIENT_SELECTOR),
  })
    ? group
    : el;
}

/** The best semantic match for a phrase across everything visible. */
export function resolveFocusElement(query: string, minScore = 58): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const ranked: { el: HTMLElement; score: number; area: number; authored: boolean }[] = [];

  for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUS_SELECTOR))) {
    if (!isOnScreen(el) || isVoiceChrome(el)) continue;
    const label = authoredLabel(el);
    const body = (el.getAttribute(NARRATE_ATTR) || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 900);
    if (!label && !body) continue;
    const authored = el.hasAttribute(NARRATE_ATTR) || el.hasAttribute(NARRATE_LABEL_ATTR);
    const score = scoreFocusText(query, { label, text: body, authored });
    if (score < minScore) continue;
    const rect = el.getBoundingClientRect();
    ranked.push({ el, score, area: rect.width * rect.height, authored });
  }

  ranked.sort(
    (a, b) => b.score - a.score || Number(b.authored) - Number(a.authored) || a.area - b.area,
  );
  const best = ranked[0]?.el;
  return best ? escalateToFocusGroup(best, query) : null;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * Resolve whatever the agent typed — a CSS selector, an aria-label, the visible
 * text, or a loose description — to one element. Exact text wins, then the
 * smallest container, then the semantic scorer at a lower bar.
 */
export function resolveElement(query: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const q = query.trim();
  if (!q) return null;

  if (/^[#.[]|[>\s]/.test(q)) {
    try {
      const bySelector = document.querySelector<HTMLElement>(q);
      if (bySelector && isOnScreen(bySelector)) return escalateToFocusGroup(bySelector, q);
    } catch {
      // Not a valid selector after all — fall through to text matching.
    }
  }

  const byAria = document.querySelector<HTMLElement>(
    `[aria-label="${cssEscape(q)}"],[title="${cssEscape(q)}"],[${NARRATE_LABEL_ATTR}="${cssEscape(q)}"]`,
  );
  if (byAria && isOnScreen(byAria)) return escalateToFocusGroup(byAria, q);

  const lower = q.toLowerCase();
  const candidates: { el: HTMLElement; exact: boolean; area: number }[] = [];
  for (const el of Array.from(
    document.querySelectorAll<HTMLElement>(`${FOCUS_SELECTOR},strong,span,[title],[aria-label]`),
  )) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!text) continue;
    const exact = text === lower;
    const contains = !exact && text.includes(lower) && text.length < lower.length + 60;
    if (!exact && !contains) continue;
    if (!isOnScreen(el) || isVoiceChrome(el)) continue;
    const rect = el.getBoundingClientRect();
    candidates.push({ el, exact, area: rect.width * rect.height });
  }
  candidates.sort((a, b) => Number(b.exact) - Number(a.exact) || a.area - b.area);

  const best = candidates[0]?.el;
  // A literal text hit is the tightest possible match, which is exactly why it
  // needs widening: the words the agent said are one line of the card it is
  // actually talking about.
  if (best) return escalateToFocusGroup(best, q);
  return resolveFocusElement(q, 34);
}

/* ------------------------------------------------------------------ */
/*  The caption clock                                                  */
/* ------------------------------------------------------------------ */

/**
 * The clause around the word being spoken right now.
 *
 * The transport gives us words, not timings, so whoever renders the captions
 * runs the clock and tells us which word is audible; this turns that index into
 * the phrase worth matching against the page. Pure, and the seam between the
 * caption strip and the pointer.
 */
export function captionFocusContext(words: string[], activeIndex: number): string {
  if (activeIndex < 0 || words.length === 0) return "";
  const end = Math.min(activeIndex, words.length - 1);
  let start = Math.max(0, end - 11);
  for (let i = end - 1; i >= start; i -= 1) {
    if (/[.!?][\]}'"”’]*$/.test(words[i])) {
      start = i + 1;
      break;
    }
  }
  return words.slice(start, end + 1).join(" ");
}

/**
 * Move the pointer in step with what is being said.
 *
 * This is what makes the guidance reliable rather than dependent on the model
 * remembering to call `point_at`: as the agent works through a row of cards,
 * the cursor steps along with the words. Re-matching the same element is a
 * no-op, so a caption frame never restarts the animation or the idle timer.
 */
export function spotlightSpokenText(clause: string, caption?: string): boolean {
  const el = resolveFocusElement(clause);
  if (!el) return false;
  if (element === el) return true;
  return setSpotlight(el, { caption: caption ?? null });
}

/* ------------------------------------------------------------------ */
/*  Tools                                                              */
/* ------------------------------------------------------------------ */

export function buildPointAtTool(toolFn: ToolFn, ctx: VoiceContext): ConciergeTool {
  return toolFn({
    name: "point_at",
    description:
      "Move the on-screen pointer onto ONE thing the person is looking at — a card, a figure, a row, a menu item, a button, a heading — while you talk about it. Call it immediately before you mention that item, and call it again for the next one as you move on. Use the exact labels read_current_page listed.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "What to point at: its visible text, its label, or a CSS selector.",
        },
        caption: {
          type: "string",
          description: "Optional two to five word caption to float beside the pointer.",
        },
      },
      required: ["target"],
      additionalProperties: false,
    },
    execute: async (args: { target?: string; caption?: string }) => {
      const query = String(args?.target ?? "").trim();
      if (!query) return "Name the thing to point at — a label, a heading or a button.";

      const el = resolveElement(query);
      if (!el) {
        return `There is nothing called "${query}" on this page. Read the page first, then point at something that is actually on it.`;
      }
      if (!setSpotlight(el, { caption: args?.caption ? String(args.caption) : null })) {
        return "The pointer is unavailable just now. Describe the item in words instead.";
      }
      return ctx.mode === "voice"
        ? `The pointer is on "${query}" now — say what it is, in one warm sentence, as if you were pointing at it.`
        : `The pointer is on "${query}" now — write one short line about it, and say where they can see it on the page.`;
    },
  }) as ConciergeTool;
}

export function buildStopPointingTool(toolFn: ToolFn, _ctx: VoiceContext): ConciergeTool {
  return toolFn({
    name: "stop_pointing",
    description:
      "Take the pointer off the page when you are done pointing at things and moving on to something else.",
    strict: false,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    execute: async () => {
      clearSpotlight();
      return "The pointer is off the page.";
    },
  }) as ConciergeTool;
}
