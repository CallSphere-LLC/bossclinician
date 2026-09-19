/**
 * page-reader.ts — "what is on the screen right now", distilled into something
 * a model can narrate accurately.
 *
 * The agent calls this after it travels somewhere, and whenever someone asks
 * "what am I looking at?". It walks the LIVE DOM and returns a compact,
 * structured `PageSnapshot` rather than a wall of text: fewer tokens, and far
 * less room for the model to invent a figure that is not on the page.
 *
 * Three tiers, most-authored first:
 *   1. Explicit opt-in — anything tagged `data-narrate` (with an optional
 *      `data-narrate-label`) is the author saying "read this". It wins.
 *   2. Semantics — the h1–h3 outline and the lead paragraphs inside <main>.
 *   3. Heuristics — stat tiles whose text is a bare number, money or a
 *      percentage, paired with the nearest short caption. That is how every
 *      dashboard in this app draws a KPI, so it is worth reading without
 *      asking anyone to annotate it.
 * Page chrome — nav, header, footer, aside, hidden and aria-hidden subtrees,
 * and anything under `data-narrate-skip` — is skipped throughout, because the
 * same menu read aloud on every page is noise.
 *
 * Everything in here is called, never run at import: the DOM is touched inside
 * `readCurrentPage` only, and even that returns an empty snapshot when there is
 * no document, so a stray server-side import is inert rather than fatal.
 */

import {
  NARRATE_ATTR,
  NARRATE_LABEL_ATTR,
  NARRATE_SKIP_ATTR,
  type ConciergeTool,
  type Kpi,
  type PageSnapshot,
  type ToolFn,
  type VoiceContext,
} from "../contract";

const SKIP_SELECTOR = [
  "nav",
  "header",
  "footer",
  "aside",
  "script",
  "style",
  "noscript",
  "svg",
  "[aria-hidden='true']",
  `[${NARRATE_SKIP_ATTR}]`,
  "[data-voice-controls]",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
].join(",");

/**
 * What a KPI value looks like on its own: a number, optionally wearing a
 * currency symbol, a percent sign or a short unit. Anything longer than that is
 * a sentence, and a sentence is body copy rather than a metric.
 */
const KPI_VALUE_RE =
  /^\s*[$€£₹]?\s*[+-]?\d[\d.,]*\s*(%|k|m|b|x|\/\s*mo|\/\s*mth|hrs?|mins?|sec|s|ms|days?|\+)?\s*$/i;

type Ranked = { text: string; inView: boolean; top: number };

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isVisible(el: Element): boolean {
  const node = el as HTMLElement;
  if (!node.isConnected) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return Number(style.opacity) !== 0;
}

/**
 * Focus targets are held to a looser standard than narrated copy: a card below
 * the fold is commonly at `opacity: 0` until a scroll-reveal animation runs,
 * and it is still a perfectly good thing to point at — scrolling to it is what
 * triggers the reveal in the first place.
 */
function isRenderable(el: Element): boolean {
  const node = el as HTMLElement;
  if (!node.isConnected) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden";
}

function inViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const height = window.innerHeight || document.documentElement.clientHeight;
  const width = window.innerWidth || document.documentElement.clientWidth;
  return rect.top < height && rect.bottom > 0 && rect.left < width && rect.right > 0;
}

function isInsideChrome(el: Element): boolean {
  return Boolean(el.closest(SKIP_SELECTOR));
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Viewport first, then top to bottom — the order a person would read them. */
function byReadingOrder(a: Ranked, b: Ranked): number {
  return Number(b.inView) - Number(a.inView) || a.top - b.top;
}

/** The nearest short caption to a bare number — how a stat tile is built. */
function labelForValue(valueEl: Element): string {
  const candidates: string[] = [];
  const push = (text: string | null | undefined) => {
    const normalized = normalizeText(text);
    if (normalized && normalized.length <= 60 && !KPI_VALUE_RE.test(normalized)) {
      candidates.push(normalized);
    }
  };
  push(valueEl.previousElementSibling?.textContent);
  push(valueEl.nextElementSibling?.textContent);
  const parent = valueEl.parentElement;
  if (parent) {
    for (const child of Array.from(parent.children)) {
      if (child === valueEl) continue;
      push(child.textContent);
    }
    push(parent.getAttribute("aria-label"));
    push(parent.getAttribute(NARRATE_LABEL_ATTR));
  }
  push(valueEl.getAttribute("aria-label"));
  return candidates[0] ?? "";
}

/**
 * Read the current page into a compact snapshot. The caps exist so a tool
 * result stays cheap even on the busiest admin screen in the app.
 */
export function readCurrentPage(opts?: {
  maxHeadings?: number;
  maxKpis?: number;
  maxChars?: number;
  maxFocusTargets?: number;
}): PageSnapshot {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { path: "", title: "", headings: [], kpis: [], excerpt: "", focusTargets: [], sparse: true };
  }

  const path = `${window.location.pathname}${window.location.search}`;
  const maxHeadings = opts?.maxHeadings ?? 12;
  const maxKpis = opts?.maxKpis ?? 10;
  const maxChars = opts?.maxChars ?? 900;
  const maxFocusTargets = opts?.maxFocusTargets ?? 64;

  const root: Element =
    document.querySelector("main, [role='main']") ?? document.body ?? document.documentElement;
  const title = normalizeText(document.title);

  /* --- the focus map: exact labels the pointer can be asked for ---------- */
  // Deliberately read from the whole document rather than <main>: an app screen
  // puts its side navigation beside main, and "point at Contacts in the menu"
  // is one of the most useful things a first-time visitor can ask for.
  const focusNodes: Ranked[] = [];
  (document.body ?? root)
    .querySelectorAll<HTMLElement>(
      `[${NARRATE_LABEL_ATTR}],[${NARRATE_ATTR}],h1,h2,h3,h4,button,a,[role='button'],[role='tab'],th,dt,li`,
    )
    .forEach((el) => {
      if (!isRenderable(el)) return;
      if (el.closest(`[${NARRATE_SKIP_ATTR}],[data-voice-controls],[aria-hidden='true']`)) return;
      const text = normalizeText(
        el.getAttribute(NARRATE_LABEL_ATTR) ||
          el.getAttribute(NARRATE_ATTR) ||
          el.getAttribute("aria-label") ||
          el.textContent,
      );
      if (!text || text.length > 180) return;
      focusNodes.push({ text, inView: inViewport(el), top: el.getBoundingClientRect().top });
    });
  const focusTargets = dedupe(focusNodes.sort(byReadingOrder).map((node) => node.text)).slice(
    0,
    maxFocusTargets,
  );

  /* --- tier 1: the authored "narrate this" map --------------------------- */
  const narrateTagged: string[] = [];
  root.querySelectorAll<HTMLElement>(`[${NARRATE_ATTR}]`).forEach((el) => {
    if (!isVisible(el) || isInsideChrome(el)) return;
    const label = normalizeText(el.getAttribute(NARRATE_LABEL_ATTR));
    const body = normalizeText(el.getAttribute(NARRATE_ATTR) || el.textContent).slice(0, 160);
    const line = [label, body].filter(Boolean).join(": ");
    if (line) narrateTagged.push(line);
  });

  /* --- tier 2: the heading outline --------------------------------------- */
  const headingNodes: Ranked[] = [];
  root.querySelectorAll<HTMLElement>("h1,h2,h3,[role='heading']").forEach((el) => {
    if (!isVisible(el) || isInsideChrome(el)) return;
    const text = normalizeText(el.textContent);
    if (!text || text.length > 120) return;
    headingNodes.push({ text, inView: inViewport(el), top: el.getBoundingClientRect().top });
  });
  const headings = dedupe(headingNodes.sort(byReadingOrder).map((node) => node.text)).slice(
    0,
    maxHeadings,
  );

  /* --- tier 3: the KPI tiles --------------------------------------------- */
  const kpis: Kpi[] = [];
  const seenKpi = new Set<string>();
  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>("div,span,p,dd,dt,strong,b,h1,h2,h3,h4"),
  )) {
    if (kpis.length >= maxKpis) break;
    // Leaf nodes only, so we read the number itself rather than a wrapper that
    // happens to contain three of them run together.
    if (el.children.length > 0) continue;
    const value = normalizeText(el.textContent);
    if (!value || value.length > 12 || !KPI_VALUE_RE.test(value)) continue;
    if (!/\d/.test(value)) continue;
    if (!isVisible(el) || isInsideChrome(el)) continue;
    const label = labelForValue(el);
    if (!label) continue;
    const key = `${label}=${value}`;
    if (seenKpi.has(key)) continue;
    seenKpi.add(key);
    kpis.push({ label, value });
  }

  /* --- the body excerpt, viewport first ---------------------------------- */
  const paragraphNodes: Ranked[] = [];
  root.querySelectorAll<HTMLElement>("p,li").forEach((el) => {
    if (!isVisible(el) || isInsideChrome(el)) return;
    const text = normalizeText(el.textContent);
    if (text.length < 40) return;
    paragraphNodes.push({ text, inView: inViewport(el), top: el.getBoundingClientRect().top });
  });
  const parts = dedupe(paragraphNodes.sort(byReadingOrder).map((node) => node.text));
  let excerpt = "";
  for (const part of parts) {
    if (excerpt.length + part.length + 1 > maxChars) {
      excerpt += part.slice(0, Math.max(0, maxChars - excerpt.length));
      break;
    }
    excerpt += (excerpt ? " " : "") + part;
    if (excerpt.length >= maxChars) break;
  }

  const sparse =
    headings.length === 0 && kpis.length === 0 && excerpt.length < 40 && narrateTagged.length === 0;

  // The authored lines lead the outline, so a page that says what matters is
  // read the way its author intended before the raw heading list.
  const mergedHeadings = dedupe([...narrateTagged, ...headings]).slice(0, maxHeadings);

  return { path, title, headings: mergedHeadings, kpis, excerpt, focusTargets, sparse };
}

/**
 * Render a snapshot into the string the model actually receives.
 *
 * Pure, and the reason the page reader is testable: the DOM walk produces data,
 * and this turns data into an instruction. The closing lines are deliberately
 * directive — left to itself a model will read a heading list aloud like a
 * table of contents, which is not what a guide sounds like.
 */
export function snapshotToPrompt(snapshot: PageSnapshot): string {
  if (snapshot.sparse) {
    return `The page at ${snapshot.path}${snapshot.title ? ` ("${snapshot.title}")` : ""} is still drawing, or has very little text on it yet. Give it a moment, then describe it or ask what they would like to see.`;
  }

  const lines: string[] = [];
  lines.push(`CURRENT PAGE: ${snapshot.title || snapshot.path} (${snapshot.path})`);
  if (snapshot.headings.length) {
    lines.push(`On screen: ${snapshot.headings.slice(0, 8).join(" · ")}`);
  }
  if (snapshot.kpis.length) {
    lines.push(`Key numbers: ${snapshot.kpis.map((kpi) => `${kpi.label} = ${kpi.value}`).join("; ")}`);
  }
  if (snapshot.excerpt) {
    lines.push(`Copy: ${snapshot.excerpt}`);
  }
  if (snapshot.focusTargets.length) {
    lines.push(`Things you can point at: ${snapshot.focusTargets.join(" · ")}`);
    lines.push(
      "Use these exact labels with point_at, one at a time, immediately before you talk about each one. Never ask them to name something this list already contains.",
    );
  }
  lines.push(
    "Describe this in one or two warm, concrete sentences — what matters here for this person — then offer where to go next.",
  );
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Tool                                                               */
/* ------------------------------------------------------------------ */

/**
 * read_current_page — the agent's eyes.
 *
 * Deliberately argument-free: what is on screen is a fact, not a query, and a
 * model given knobs to turn will turn them instead of looking.
 */
export function buildReadPageTool(toolFn: ToolFn, _ctx: VoiceContext): ConciergeTool {
  return toolFn({
    name: "read_current_page",
    description:
      "Read what is on this person's screen right now — the page title, the headings, any key figures, the main copy, and the exact labels of everything you could point at. Call it whenever you want to describe what they are looking at, answer \"what is this?\", or walk them through several things on the page.",
    strict: false,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    execute: async () => snapshotToPrompt(readCurrentPage()),
  }) as ConciergeTool;
}
