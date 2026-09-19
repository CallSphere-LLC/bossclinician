import { buildAdminCatalogTool } from "./admin-catalog";
/**
 * registry.ts — one table, from capability name to the factory that builds it.
 *
 * This is the open/closed seam the whole slice is arranged around: a new
 * capability is one factory in its own file plus one line here, and no surface,
 * transport or policy has to learn anything new to switch it on. A policy that
 * does not list a name does not get the tool, and the model is never told the
 * capability exists — which is the browser half of the access rules.
 *
 * What comes out is a list of `ConciergeTool` descriptors, which is why the
 * spoken concierge and the typed one behave identically: both transports take
 * this same list and run `execute` in the browser, because that is where the
 * DOM and the router are.
 */

import type {
  ConciergeTool,
  ToolFn,
  VoiceContext,
  VoiceSurfacePolicy,
  VoiceToolName,
} from "../contract";
import {
  buildGoBackTool,
  buildNavigateTool,
  buildSearchSiteTool,
  createGuidedHistory,
  type GuidedHistory,
} from "./navigation";
import { buildReadPageTool } from "./page-reader";
import { buildPointAtTool, buildStopPointingTool, clearSpotlight } from "./spotlight";
import { buildMyAccountSummaryTool } from "./member-data";
import {
  buildProposeAdminActionTool,
  buildRunApprovedActionTool,
  createProposalStore,
  type ProposalStore,
} from "./admin-actions";
import {
  buildEndTourTool,
  buildNextTourStopTool,
  buildStartTourTool,
  createTourState,
  registerTourSession,
  type TourState,
} from "./tour";

/**
 * The state one call shares between its tools: where it has travelled, which
 * changes have been approved, and how far round the walkthrough it is. It is
 * created per `buildVoiceTools`, so two sessions in two tabs never see each
 * other's history or each other's approvals.
 */
type SessionState = {
  policy: VoiceSurfacePolicy;
  history: GuidedHistory;
  proposals: ProposalStore;
  tour: TourState;
  onDepart: () => void;
};

type Factory = (toolFn: ToolFn, ctx: VoiceContext, state: SessionState) => ConciergeTool;

const FACTORIES: Record<VoiceToolName, Factory> = {
  navigate_to: (toolFn, ctx, state) =>
    buildNavigateTool(toolFn, ctx, { policy: state.policy, history: state.history, onDepart: state.onDepart, canNavigate: () => {
      const turn = ctx.getUserTurn?.();
      return !state.tour.running || (!!turn && state.tour.consumedTurn !== turn.id && /\b(open|go to|take me to|show me|navigate|back|return)\b/i.test(turn.text));
    } }),
  go_back: (toolFn, ctx, state) =>
    buildGoBackTool(toolFn, ctx, { policy: state.policy, history: state.history, onDepart: state.onDepart, canNavigate: () => {
      const turn = ctx.getUserTurn?.();
      return !state.tour.running || (!!turn && state.tour.consumedTurn !== turn.id && /\b(open|go to|take me to|show me|navigate|back|return)\b/i.test(turn.text));
    } }),
  read_current_page: (toolFn, ctx) => buildReadPageTool(toolFn, ctx),
  point_at: (toolFn, ctx) => buildPointAtTool(toolFn, ctx),
  stop_pointing: (toolFn, ctx) => buildStopPointingTool(toolFn, ctx),
  search_site: (toolFn, ctx, state) => buildSearchSiteTool(toolFn, ctx, { policy: state.policy }),
  my_account_summary: (toolFn, ctx) => buildMyAccountSummaryTool(toolFn, ctx),
  admin_operation_catalog: (toolFn, ctx) => buildAdminCatalogTool(toolFn, ctx),
  propose_admin_action: (toolFn, ctx, state) =>
    buildProposeAdminActionTool(toolFn, ctx, state.proposals),
  run_approved_action: (toolFn, ctx, state) =>
    buildRunApprovedActionTool(toolFn, ctx, state.proposals),
  start_guided_tour: (toolFn, ctx, state) =>
    buildStartTourTool(toolFn, ctx, { policy: state.policy, history: state.history, state: state.tour }),
  next_tour_stop: (toolFn, ctx, state) =>
    buildNextTourStopTool(toolFn, ctx, { policy: state.policy, history: state.history, state: state.tour }),
  end_guided_tour: (toolFn, ctx, state) =>
    buildEndTourTool(toolFn, ctx, { policy: state.policy, history: state.history, state: state.tour }),
};

/**
 * Build the tools this surface's policy switches on.
 *
 * `toolFn` is the transport's own wrapper, injected rather than imported so
 * nothing here pulls the realtime SDK — or anything else — onto the server
 * render path. The text transport passes a function that returns its argument
 * unchanged, because a descriptor is already everything it needs.
 */
export function buildVoiceTools(
  policy: VoiceSurfacePolicy,
  toolFn: ToolFn,
  ctx: VoiceContext,
): ConciergeTool[] {
  const state: SessionState = {
    policy,
    history: createGuidedHistory(ctx),
    proposals: createProposalStore(),
    tour: createTourState(),
    // A pointer left hovering while the page changes underneath it points at
    // whatever now happens to be in that spot, which is worse than nothing.
    onDepart: clearSpotlight,
  };

  // The walkthrough bar is one component with no session to be handed, so the
  // session it should reflect is published here as it is built.
  registerTourSession(ctx, policy, state.tour);

  const built: ConciergeTool[] = [];
  const seen = new Set<VoiceToolName>();
  for (const name of policy.tools) {
    if (seen.has(name)) continue;
    seen.add(name);
    const factory = FACTORIES[name];
    if (!factory) continue;
    built.push(factory(toolFn, ctx, state));
  }
  return built;
}
