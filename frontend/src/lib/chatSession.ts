const SESSION_KEY = "bc_chat_session_id";

/**
 * Held in the module as well as in storage: a browser with storage blocked
 * (private mode, third-party contexts) would otherwise mint a new id for every
 * line spoken, and one conversation would arrive as a dozen sessions.
 */
let cached: string | null = null;

function readStored(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string): void {
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    // A conversation that works matters more than one that survives a reload.
  }
}

function mint(): string {
  // randomUUID needs a secure context and a recent browser; the chat widget
  // does not, and must not start failing on an old phone over an id format.
  // Whoever holds the id can write into that conversation, so the fallback is
  // still drawn from the CSPRNG: getRandomValues has neither restriction.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `bc-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The visitor's chat session id, shared by the typed widget and the voice
 * agent so both halves of one conversation land on one transcript.
 *
 * Voice cannot wait for the server to hand an id back the way the text chat
 * does: the realtime stream has to name a session from its first transcribed
 * line, before any request of ours has been made. So the id is minted here
 * when there isn't one, and the text chat reuses whatever it finds.
 */
export function chatSessionId(): string {
  if (cached) return cached;
  cached = readStored() ?? mint();
  writeStored(cached);
  return cached;
}

/** Stores the id the chat endpoint answered with, in case it minted its own. */
export function rememberChatSessionId(id: string): void {
  cached = id;
  writeStored(id);
}
