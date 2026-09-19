/**
 * The text transport: the concierge as it behaves for someone typing.
 *
 * One import for the chat widget, and the seam anything else would use if a
 * second typed surface ever appears.
 */

export { currentLocation, useConciergeChat, type ConciergeChatHandle } from "./useConciergeChat";
export { useFirstVisitOffer, type FirstVisitOffer } from "./firstVisitOffer";
export {
  ConciergeLoopError,
  MAX_TOOL_ROUNDS,
  MAX_WIRE_MESSAGES,
  readApprovalAnswer,
  runConciergeTurn,
  toolDescriptors,
  toolOutputContent,
  type ConciergeTurn,
} from "./conciergeLoop";
