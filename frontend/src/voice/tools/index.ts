/**
 * The concierge's hands: travel, page reading, pointing, the member's own data,
 * approved admin changes and the first-run walkthrough.
 *
 * Everything the rest of the app needs is here, and nothing here imports React,
 * the router or a fetch client — a tool receives what it needs through
 * `VoiceContext`, which is what lets these run under either transport and be
 * tested without a browser.
 */

export { buildVoiceTools } from "./registry";

/**
 * The spotlight store, consumed by the cursor overlay through
 * `useSyncExternalStore`. `pointerAnchor` comes with it because the state
 * carries a rect and the overlay has to turn that rect into a cursor position;
 * keeping that rule here — pure and shared — means the placement can be
 * changed, or checked, in one place.
 */
export {
  clearSpotlight,
  getSpotlightSnapshot,
  getSpotlightServerSnapshot,
  captionWidth,
  isSpotlightSuppressed,
  pointerAnchor,
  setSpotlight,
  setSpotlightCaption,
  setSpotlightSuppressed,
  subscribeSpotlight,
  captionFocusContext,
  spotlightSpokenText,
  resolveElement,
  type PointerAnchor,
  type PointerRect,
  type SpotlightState,
  type Viewport,
} from "./spotlight";

/** Reading the live page, for anything that wants a snapshot of its own. */
export { readCurrentPage, snapshotToPrompt } from "./page-reader";

/** The navigation gate, so a surface can check a path without a tool call. */
export {
  destinationCatalogForPrompt,
  destinationKeys,
  resolveDestination,
  surfaceForPath,
  type DestinationResolution,
} from "./navigation";

/** The walkthrough's memory, for the first-visit greeting decision. */
export {
  loadTourProgress,
  saveTourProgress,
  resumeCursor,
  mergeTourProgress,
  readTourMirror,
} from "./tour";

/**
 * The walkthrough's live state, for the bar that shows which stop this is and
 * offers a way out. `index` counts from zero, like `TourProgress`; `null` means
 * nothing is running. Ending from the bar is recorded through the same progress
 * store the tools use, so a walkthrough stopped by hand is not offered again.
 */
export {
  subscribeTour,
  getTourSnapshot,
  getTourServerSnapshot,
  endTour,
  pauseTour,
  resumeTour,
  tourSnapshotFrom,
  type TourRunState,
} from "./tour";
