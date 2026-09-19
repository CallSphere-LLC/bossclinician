/**
 * kernel/index.ts — the seam the rest of the concierge is allowed to reach for.
 *
 * Everything here is transport: microphone, WebRTC, the GPT-Live wire protocol,
 * captions and levels. It knows nothing about destinations, tools, the cursor
 * or any surface, and it must stay that way — the whole point of the policy is
 * that adding a capability never reaches into this folder.
 */

export { useVoiceSession } from "./useVoiceSession";
export type { VoiceStatus, VoiceSessionHandle, VoiceSessionInput } from "./useVoiceSession";

export { createVoiceApiClient, putVoiceRecording } from "./api-client";

export { requestAdmission, describeVoiceError } from "./connect";

/**
 * The caption feed and the level meter, for the UI to read directly. Captions
 * come through `useVoiceSession`; these are here for anything that wants the
 * store without owning a call (the spotlight's caption pill, for one).
 */
export {
  subscribeVoiceCaptions,
  getVoiceCaptions,
  getServerVoiceCaptions,
  clearVoiceCaptions,
  readVoiceAgentLevels,
  captionWordDurationMs,
  captionFocusContext,
  shouldAdvanceCaptionClock,
  realtimeAgentSpeechState,
  CAPTION_METER_SILENCE_FALLBACK_MS,
  CAPTION_METER_SPEECH_FLOOR,
} from "./audio-tap";
export type { LiveLevels } from "./audio-tap";
