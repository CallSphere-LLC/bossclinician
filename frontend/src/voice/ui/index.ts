/**
 * The concierge's face.
 *
 * `VoiceConcierge` is the whole spoken widget and the composition root: the
 * surfaces slice mounts it with a policy and nothing else. The pieces below it
 * are exported separately because the typed chat is the same assistant through
 * a different door — it points with the same cursor and asks for the same
 * approvals — and none of those pieces knows or cares which door was used.
 *
 * Mount `VoiceSpotlight` and `ApprovalHost` freely: each claims its name, so
 * the second one on a page renders nothing rather than doubling the cursor or
 * asking the owner the same question twice.
 */

export { VoiceConcierge } from "./VoiceConcierge";

export { VoiceOrb } from "./VoiceOrb";
export { VoiceSpotlight } from "./VoiceSpotlight";
export { VoiceCaptions } from "./VoiceCaptions";
export { VoiceTourBar } from "./VoiceTourBar";

export { ApprovalCard, ApprovalHost } from "./ApprovalCard";
export {
  APPROVAL_TIMEOUT_MS,
  answerApprovalByChat,
  answerApprovalByClick,
  answerApprovalByVoice,
  cancelPendingApprovals,
  createApprovalStore,
  getApprovalServerSnapshot,
  getApprovalSnapshot,
  requestApproval,
  subscribeApprovals,
  type AnswerResult,
  type ApprovalStore,
  type PendingApproval,
} from "./approval-store";

export {
  RecordingCorrection,
  RecordingDisclosure,
  disclosureUnderstated,
  hasSeenDisclosure,
  rememberDisclosure,
  rememberRecordingVerdict,
  willDiscloseRecording,
} from "./RecordingDisclosure";

export { decideGreeting, type GreetingDecision } from "./first-visit";
