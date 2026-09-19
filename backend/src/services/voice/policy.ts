/**
 * policy.ts — the server's own copy of what each surface may do.
 *
 * The browser has a policy object too (frontend/src/voice/contract.ts), and it
 * decides what the model is TOLD about. This file is the independent second
 * copy that decides what the server will actually act on, which is why it does
 * not import anything from the frontend and why the tool names are written out
 * again here rather than shared: a list one tampered bundle can edit is not a
 * list the server may consult.
 *
 * Everything here is pure — no database, no network, no clock it does not take
 * as an argument — so services/voice/voicePolicy.test.ts can exercise the whole
 * of it without a Postgres or an OpenAI key.
 */

import { SURFACE_LIMITS, type VoiceIdentity, type VoiceSurface } from "./contract";

/* ============================== tool table ============================== */

/**
 * The capabilities each surface owns.
 *
 * Deliberately a duplicate of the frontend policies rather than an import of
 * them. The browser sends its tool DESCRIPTORS up with every text turn (the
 * `ConciergeChatRequest.tools` field), and if the server took that list at face
 * value a patched bundle could describe `run_approved_action` into a session a
 * signed-out visitor opened. The submitted list is therefore only ever narrowed
 * against this table — see `admissibleTools`.
 *
 * The three tiers are cumulative on purpose: everything a visitor may do, a
 * member may do too, and Yvette may do everything a member may.
 */
const PUBLIC_TOOLS = [
  "navigate_to",
  "go_back",
  "read_current_page",
  "point_at",
  "stop_pointing",
  "search_site",
  "start_guided_tour",
  "next_tour_stop",
  "end_guided_tour",
] as const;

/** Reading a member their own orders, progress and receipts. */
const MEMBER_TOOLS = [...PUBLIC_TOOLS, "my_account_summary"] as const;

/** The owner's two-step privileged path: propose, get approval, then run. */
const ADMIN_TOOLS = [...MEMBER_TOOLS, "propose_admin_action", "run_approved_action"] as const;

export const SURFACE_TOOLS: Record<VoiceSurface, readonly string[]> = {
  public: PUBLIC_TOOLS,
  member: MEMBER_TOOLS,
  admin: ADMIN_TOOLS,
};

/**
 * How many tool descriptors one chat turn may carry, and what a name may look
 * like. Both are bounds on what reaches OpenAI: the model is billed for every
 * descriptor in the request, and a name outside this alphabet is rejected by
 * the provider anyway — better to refuse it here, where the reason is legible,
 * than to forward it and read the refusal back out of a 400.
 */
const MAX_TOOLS_PER_TURN = 16;
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export type SubmittedTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * The tools from a chat request this surface is actually allowed to use.
 *
 * Order is the caller's, duplicates are dropped (the first wins), anything the
 * surface does not own is dropped silently rather than refused: a client one
 * deploy behind may legitimately still describe a tool that has moved tiers,
 * and answering that with a 403 would break the chat instead of narrowing it.
 * The cap is applied last, so a flood of junk names cannot push the real tools
 * out of the list.
 */
export function admissibleTools(
  surface: VoiceSurface,
  submitted: readonly SubmittedTool[],
): SubmittedTool[] {
  const allowed = new Set(SURFACE_TOOLS[surface]);
  const seen = new Set<string>();
  const kept: SubmittedTool[] = [];

  for (const tool of submitted) {
    if (kept.length >= MAX_TOOLS_PER_TURN) break;
    if (!tool || typeof tool.name !== "string") continue;
    if (!TOOL_NAME.test(tool.name)) continue;
    if (!allowed.has(tool.name)) continue;
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    kept.push({
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description.slice(0, 1024) : "",
      parameters:
        tool.parameters && typeof tool.parameters === "object"
          ? tool.parameters
          : { type: "object", properties: {}, additionalProperties: false },
    });
  }

  return kept;
}

/* ============================ per-caller cap ============================ */

/**
 * Who a session-per-hour budget belongs to.
 *
 * A signed-in person is counted as themselves, so a clinic whose staff share
 * one office address do not share one allowance.
 *
 * An anonymous visitor is counted by their visitor cookie, and only by their
 * address when there is no cookie yet. That looks like the weaker choice and is
 * the only workable one: req.ip is a constant in production on this host (see
 * the `trust proxy` note in app.ts), so an address-keyed budget of six sessions
 * an hour would be six for the entire public site rather than six per person.
 * A cleared cookie buys a fresh allowance, which is what the per-IP burst
 * limiter and the one-use admission are there to bound.
 */
export function callerKey(
  identity: VoiceIdentity,
  caller: { visitorId?: string | null; ip: string },
): string {
  if (identity.audience === "admin") return `admin:${identity.adminUserId}`;
  if (identity.audience === "member") return `member:${identity.memberId}`;
  if (caller.visitorId) return `visitor:${caller.visitorId}`;
  return `ip:${caller.ip}`;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Safety valve on the map below. Each entry is a handful of numbers, so this is
 * generous; it exists so a flood of distinct keys cannot grow the heap without
 * bound in a process that also renders the marketing site.
 */
const MAX_TRACKED_CALLERS = 5000;

const recentSessions = new Map<string, number[]>();

/**
 * Takes one session out of a caller's hourly allowance, or reports that it is
 * spent.
 *
 * A sliding window of timestamps rather than a fixed bucket, because a fixed
 * bucket lets a caller spend the whole allowance twice across a boundary — on
 * the admin surface that is 120 sessions in two minutes. In process memory, so
 * it resets on deploy: this is a cost guard on top of the admission and the
 * per-IP limiter, not a correctness mechanism, and one backend container is
 * what this app runs (docker-compose.yml).
 */
export function claimSessionSlot(
  key: string,
  surface: VoiceSurface,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const limit = SURFACE_LIMITS[surface].sessionsPerHour;
  const since = now - HOUR_MS;
  const kept = (recentSessions.get(key) ?? []).filter((at) => at > since);

  if (kept.length >= limit) {
    // The oldest timestamp in the window is the one whose expiry frees a slot.
    const oldest = kept[0] ?? now;
    recentSessions.set(key, kept);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + HOUR_MS - now) / 1000)),
    };
  }

  kept.push(now);
  // Delete before re-inserting so the map's insertion order is recency order,
  // which is what makes the eviction below evict the right key.
  recentSessions.delete(key);
  if (recentSessions.size >= MAX_TRACKED_CALLERS) {
    // Drop the least recently touched caller rather than refusing this one: the
    // map is a budget, and losing a budget is better than losing a session.
    const stalest = recentSessions.keys().next().value;
    if (stalest !== undefined) recentSessions.delete(stalest);
  }
  recentSessions.set(key, kept);
  return { allowed: true, retryAfterSeconds: 0 };
}

/* ============================== request shape =========================== */

/** Everything below is a bound on what one request may carry into the model. */
export const MAX_CHAT_MESSAGES = 40;
export const MAX_CHAT_CONTENT_CHARS = 8000;
export const MAX_PATH_CHARS = 512;

/**
 * The visitor's location, as the server is willing to repeat it to the model.
 *
 * An in-app path and nothing else: no scheme, no host, no protocol-relative
 * `//evil.example` — the concierge narrates this string and the tools navigate
 * relative to it, so an absolute URL here is a redirect the model can be talked
 * into reading out.
 */
export function normalisePath(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/";
  return trimmed.slice(0, MAX_PATH_CHARS);
}
