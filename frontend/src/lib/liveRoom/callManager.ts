/**
 * The community live room's WebRTC engine.
 *
 * Ported from the CallSphere Health telehealth CallManager that runs on this
 * same host, and widened from a 1:1 visit to an N-way mesh. What carried over
 * unchanged in spirit:
 *
 *   - Module-level state, not component state. The call survives navigating
 *     between community pages; only `leave()` tears it down.
 *   - PERFECT NEGOTIATION (MDN) so either side may originate an offer and glare
 *     resolves without fixed caller/callee roles. Rejoins and renegotiation
 *     (screen share) are therefore ordinary rather than special.
 *   - Local media acquired ONCE, up front, before signalling: one permission
 *     prompt, retryable, and the same tracks feed every peer.
 *   - Presence is whatever the server says. Never inferred from a peer's own
 *     claim, so it cannot be lost to a join race.
 *
 * What had to change is the shape. A 1:1 call is one RTCPeerConnection and can
 * broadcast every signal; a mesh of four is six independent negotiations, so
 * each remote peer gets its own connection, its own negotiation flags, and its
 * own addressed signals. Politeness is decided by comparing the two peer ids —
 * the lower one is polite — which is symmetric, needs no roles, and gives both
 * ends the same answer without another round trip.
 *
 * A mesh means each browser uploads its camera once per other participant, so
 * the room is capacity-capped server-side. This is the right trade for office
 * hours; a webinar for two hundred needs an SFU, which is a different piece of
 * infrastructure and not pretended at here.
 */

import { getAccessToken } from "@/lib/memberApi";

/** Matches memberApi so a deployment that moves the API moves this with it. */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export type RoomStatus =
  | "idle"
  | "connecting" // acquiring devices, ICE config and the signalling stream
  | "waiting" // in the room, nobody else here yet
  | "live" // at least one peer connected
  | "left"
  | "error";

export interface RemoteParticipant {
  peerId: string;
  memberId: number;
  name: string;
  avatarUrl: string;
  role: string;
  stream: MediaStream | null;
  /** True once this leg's connection is actually up. */
  connected: boolean;
}

export interface RoomChatMessage {
  id: string;
  memberId: number;
  name: string;
  text: string;
  at: string;
  mine: boolean;
}

export interface RoomSnapshot {
  slug: string | null;
  status: RoomStatus;
  error: string | null;
  localStream: MediaStream | null;
  participants: RemoteParticipant[];
  micOn: boolean;
  camOn: boolean;
  sharing: boolean;
  chat: RoomChatMessage[];
  /** False when no TURN relay is configured — surfaced, never hidden. */
  relayAvailable: boolean;
}

interface IncomingSignal {
  kind: "presence" | "desc" | "candidate" | "bye" | "chat" | "net";
  senderId: string;
  to: string;
  from: { memberId: number; name: string };
  payload?: unknown;
  at: string;
}

interface RosterEntry {
  peerId: string;
  memberId: number;
  name: string;
  avatarUrl: string;
  role: string;
}

/** One leg of the mesh: everything that belongs to a single remote peer. */
interface PeerLeg {
  pc: RTCPeerConnection;
  info: RosterEntry;
  stream: MediaStream | null;
  connected: boolean;
  /** Perfect-negotiation flags, per leg — they cannot be shared across peers. */
  makingOffer: boolean;
  ignoreOffer: boolean;
  polite: boolean;
}

/* ------------------------------------------------------------ module state */

let slug: string | null = null;
let status: RoomStatus = "idle";
let error: string | null = null;
let localStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;
let micOn = true;
let camOn = true;
let chat: RoomChatMessage[] = [];
let relayAvailable = false;
let iceServers: RTCIceServer[] = [];
let myPeerId = "";
let rawPeerId = "";
let source: EventSource | null = null;
let myMemberId = 0;

const legs = new Map<string, PeerLeg>();
const listeners = new Set<(snapshot: RoomSnapshot) => void>();

function idle(): RoomSnapshot {
  return {
    slug: null,
    status: "idle",
    error: null,
    localStream: null,
    participants: [],
    micOn: true,
    camOn: true,
    sharing: false,
    chat: [],
    relayAvailable: false,
  };
}

function snapshot(): RoomSnapshot {
  return {
    slug,
    status,
    error,
    localStream,
    participants: [...legs.values()].map((leg) => ({
      ...leg.info,
      stream: leg.stream,
      connected: leg.connected,
    })),
    micOn,
    camOn,
    sharing: screenStream !== null,
    chat,
    relayAvailable,
  };
}

function publish(): void {
  const next = snapshot();
  for (const listener of listeners) listener(next);
}

export function subscribeRoom(listener: (snapshot: RoomSnapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function getRoomSnapshot(): RoomSnapshot {
  return snapshot();
}

export function getIdleSnapshot(): RoomSnapshot {
  return idle();
}

/* ------------------------------------------------------------- signalling */

/**
 * The same in-memory access token the rest of the member app sends, read from
 * `memberApi` rather than duplicated here — a second copy would go stale the
 * first time a refresh rotated it.
 */
function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function post(kind: IncomingSignal["kind"], to: string, payload?: unknown): Promise<void> {
  if (!slug) return;
  try {
    await fetch(`${API_BASE}/member/community/${encodeURIComponent(slug)}/live/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ kind, senderId: rawPeerId, to, payload }),
    });
  } catch {
    // A dropped signal is recoverable — ICE retries, and presence re-syncs on
    // the next roster broadcast. Tearing the room down over one failed POST is
    // worse than letting the negotiation retry.
  }
}

/* ------------------------------------------------------------------- legs */

function closeLeg(peerId: string): void {
  const leg = legs.get(peerId);
  if (!leg) return;
  try {
    leg.pc.ontrack = null;
    leg.pc.onicecandidate = null;
    leg.pc.onnegotiationneeded = null;
    leg.pc.onconnectionstatechange = null;
    leg.pc.close();
  } catch {
    /* already closed */
  }
  legs.delete(peerId);
}

function currentTracks(): MediaStreamTrack[] {
  const from = screenStream ?? localStream;
  return from ? from.getTracks() : [];
}

/**
 * Opens a leg to one peer.
 *
 * `polite` is derived from the two ids rather than assigned, so both ends agree
 * without asking each other: with the same rule on both sides exactly one of
 * any pair is polite.
 */
function openLeg(info: RosterEntry): PeerLeg {
  const existing = legs.get(info.peerId);
  if (existing) {
    existing.info = info;
    return existing;
  }

  const pc = new RTCPeerConnection({ iceServers });
  const leg: PeerLeg = {
    pc,
    info,
    stream: null,
    connected: false,
    makingOffer: false,
    ignoreOffer: false,
    polite: myPeerId < info.peerId,
  };
  legs.set(info.peerId, leg);

  for (const track of currentTracks()) {
    try {
      pc.addTrack(track, (screenStream ?? localStream) as MediaStream);
    } catch {
      /* a track already attached to this connection */
    }
  }

  pc.ontrack = (event) => {
    // The first stream on the leg is the peer's; `streams[0]` is what the
    // sender grouped them into, so tracks arriving separately still land in one.
    leg.stream = event.streams[0] ?? new MediaStream([event.track]);
    publish();
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) void post("candidate", info.peerId, event.candidate.toJSON());
  };

  pc.onnegotiationneeded = async () => {
    try {
      leg.makingOffer = true;
      // Implicit setLocalDescription: the browser builds the right description
      // for whatever state the connection is in, which is the whole point of
      // the modern form of this pattern.
      await pc.setLocalDescription();
      if (pc.localDescription) await post("desc", info.peerId, pc.localDescription.toJSON());
    } catch {
      /* a renegotiation that raced a teardown */
    } finally {
      leg.makingOffer = false;
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    leg.connected = state === "connected";
    if (state === "failed") {
      // ICE gave up on this pair. Restart rather than close: the peer is still
      // in the room as far as the server is concerned, and a relay candidate
      // may succeed where a direct one did not.
      try {
        pc.restartIce();
      } catch {
        /* not supported; the next presence broadcast will rebuild the leg */
      }
    }
    if (state === "closed") legs.delete(info.peerId);
    recomputeStatus();
    publish();
  };

  return leg;
}

function recomputeStatus(): void {
  if (status === "idle" || status === "left" || status === "error") return;
  const anyConnected = [...legs.values()].some((leg) => leg.connected);
  status = anyConnected ? "live" : legs.size > 0 ? "connecting" : "waiting";
}

/* --------------------------------------------------------- signal handling */

async function onDesc(leg: PeerLeg, description: RTCSessionDescriptionInit): Promise<void> {
  const { pc } = leg;
  const offerCollision =
    description.type === "offer" && (leg.makingOffer || pc.signalingState !== "stable");

  leg.ignoreOffer = !leg.polite && offerCollision;
  if (leg.ignoreOffer) return; // the impolite peer keeps its own offer

  // Rolls back automatically on the polite side of a collision.
  await pc.setRemoteDescription(description);
  if (description.type === "offer") {
    await pc.setLocalDescription(); // implicit answer
    if (pc.localDescription) await post("desc", leg.info.peerId, pc.localDescription.toJSON());
  }
}

function onPresence(roster: RosterEntry[]): void {
  const present = new Set<string>();
  for (const entry of roster) {
    if (entry.peerId === myPeerId) continue;
    present.add(entry.peerId);
    const isNew = !legs.has(entry.peerId);
    const leg = openLeg(entry);
    // The impolite peer of the pair opens the conversation. Either could —
    // perfect negotiation would survive both — but having one of them do it
    // halves the glare and the wasted offers on a busy join.
    if (isNew && !leg.polite) {
      void (async () => {
        try {
          leg.makingOffer = true;
          await leg.pc.setLocalDescription();
          if (leg.pc.localDescription) {
            await post("desc", entry.peerId, leg.pc.localDescription.toJSON());
          }
        } catch {
          /* the leg went away mid-offer */
        } finally {
          leg.makingOffer = false;
        }
      })();
    }
  }

  // Anybody the server no longer lists has gone. Closing here rather than
  // waiting for ICE to fail is what makes a tile vanish promptly.
  for (const peerId of [...legs.keys()]) {
    if (!present.has(peerId)) closeLeg(peerId);
  }

  recomputeStatus();
  publish();
}

function handleSignal(signal: IncomingSignal): void {
  if (signal.kind === "presence") {
    const payload = signal.payload as { roster?: RosterEntry[] } | undefined;
    onPresence(payload?.roster ?? []);
    return;
  }

  if (signal.kind === "chat") {
    const payload = signal.payload as { text?: string } | undefined;
    const text = (payload?.text ?? "").trim();
    if (!text) return;
    chat = [
      ...chat,
      {
        id: `${signal.senderId}:${signal.at}`,
        memberId: signal.from.memberId,
        name: signal.from.name,
        text,
        at: signal.at,
        mine: signal.from.memberId === myMemberId,
      },
    ].slice(-200);
    publish();
    return;
  }

  if (signal.kind === "bye") {
    closeLeg(signal.senderId);
    recomputeStatus();
    publish();
    return;
  }

  const leg = legs.get(signal.senderId);
  if (!leg) return; // a signal from somebody presence has not introduced yet

  if (signal.kind === "desc") {
    void onDesc(leg, signal.payload as RTCSessionDescriptionInit).catch(() => {
      /* expected right after a rollback */
    });
    return;
  }

  if (signal.kind === "candidate") {
    void leg.pc.addIceCandidate(signal.payload as RTCIceCandidateInit).catch(() => {
      // Candidates for a description we rolled back are meaningless; only a
      // genuine failure matters, and it will show as a failed connection.
      if (!leg.ignoreOffer) {
        /* swallowed deliberately */
      }
    });
  }
}

/* ------------------------------------------------------------------ public */

function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Opens the signalling stream.
 *
 * `EventSource` cannot send an Authorization header, so rather than putting the
 * member's access token in a URL — where nginx logs it — we swap it for a
 * one-minute single-use ticket first and connect with that.
 */
async function openStream(): Promise<void> {
  if (!slug) return;
  const res = await fetch(
    `${API_BASE}/member/community/${encodeURIComponent(slug)}/live/ticket`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ peerId: rawPeerId }),
    }
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    status = "error";
    error = body.error || "We couldn't get you into the room.";
    publish();
    return;
  }
  const { ticket, peerId } = (await res.json()) as { ticket: string; peerId: string };
  // The server's own binding, so echo filtering and politeness both agree with
  // the ids it stamps on relayed signals.
  myPeerId = peerId;

  const query = new URLSearchParams({ ticket, peerId });
  source = new EventSource(`${API_BASE}/community-live/stream?${query.toString()}`);
  source.addEventListener("signal", (event) => {
    try {
      handleSignal(JSON.parse((event as MessageEvent).data) as IncomingSignal);
    } catch {
      /* a malformed frame is not worth ending a call over */
    }
  });
  source.onerror = () => {
    // A ticket is single-use, so EventSource's built-in retry would replay a
    // spent one and be refused forever. Close it and re-mint instead — the
    // server ref-counts membership, so the brief overlap does not read as a
    // leave, and the roster comes back on the next presence broadcast.
    if (!slug || status === "idle" || status === "left") return;
    source?.close();
    source = null;
    window.setTimeout(() => {
      if (slug && status !== "idle" && status !== "left") void openStream();
    }, RECONNECT_DELAY_MS);
  };
}

/** Long enough not to hammer a server that is restarting, short enough to feel instant. */
const RECONNECT_DELAY_MS = 1_500;

export interface JoinRoomOptions {
  slug: string;
  memberId: number;
  /** Start with the camera off — the room is often joined to listen. */
  video?: boolean;
}

export async function joinRoom(options: JoinRoomOptions): Promise<void> {
  if (slug === options.slug && status !== "idle" && status !== "left" && status !== "error") {
    return; // already in this room
  }
  await leaveRoom();

  slug = options.slug;
  myMemberId = options.memberId;
  status = "connecting";
  error = null;
  chat = [];
  camOn = options.video !== false;
  micOn = true;
  publish();

  try {
    // Media first, and once: a single permission prompt, and the tracks are
    // ready before any peer can offer to us.
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: options.video !== false,
    });
    for (const track of localStream.getVideoTracks()) track.enabled = camOn;
  } catch (err) {
    status = "error";
    error =
      (err as Error).name === "NotAllowedError"
        ? "We need permission to use your camera and microphone to join the room."
        : "We couldn't reach your camera or microphone. Check that nothing else is using them.";
    publish();
    return;
  }

  try {
    const res = await fetch(
      `${API_BASE}/member/community/${encodeURIComponent(options.slug)}/live/ice`,
      { headers: authHeaders() }
    );
    if (res.ok) {
      const body = (await res.json()) as { iceServers?: RTCIceServer[]; turn?: boolean };
      iceServers = body.iceServers ?? [];
      relayAvailable = body.turn === true;
    }
  } catch {
    // No ICE config still leaves host candidates, which work on one network.
    iceServers = [];
    relayAvailable = false;
  }

  rawPeerId = randomId();
  status = "waiting";
  publish();
  await openStream();
}

export async function leaveRoom(): Promise<void> {
  if (source) {
    source.close();
    source = null;
  }
  if (slug && rawPeerId) void post("bye", "");

  for (const peerId of [...legs.keys()]) closeLeg(peerId);

  for (const track of localStream?.getTracks() ?? []) track.stop();
  for (const track of screenStream?.getTracks() ?? []) track.stop();
  localStream = null;
  screenStream = null;

  slug = null;
  rawPeerId = "";
  myPeerId = "";
  status = "left";
  chat = [];
  publish();
  status = "idle";
}

export function setMic(on: boolean): void {
  micOn = on;
  for (const track of localStream?.getAudioTracks() ?? []) track.enabled = on;
  publish();
}

export function setCam(on: boolean): void {
  camOn = on;
  for (const track of localStream?.getVideoTracks() ?? []) track.enabled = on;
  publish();
}

export function sendRoomChat(text: string): void {
  const body = text.trim();
  if (!body) return;
  // Shown locally at once. The server does not echo a sender's own signal back,
  // so waiting for a round trip would mean never seeing your own message.
  chat = [
    ...chat,
    {
      id: `me:${Date.now()}`,
      memberId: myMemberId,
      name: "You",
      text: body,
      at: new Date().toISOString(),
      mine: true,
    },
  ].slice(-200);
  publish();
  void post("chat", "", { text: body });
}

/**
 * Replaces the camera track with the screen on every leg.
 *
 * `replaceTrack` rather than remove-and-add: it swaps what a sender is
 * transmitting without renegotiating, so a room of six does not run six SDP
 * exchanges because one person shared a slide.
 */
export async function startScreenShare(): Promise<void> {
  if (screenStream) return;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  } catch {
    return; // the picker was dismissed
  }
  const track = screenStream.getVideoTracks()[0];
  if (!track) return;
  // The browser's own "Stop sharing" button ends the track without telling us.
  track.addEventListener("ended", () => void stopScreenShare());
  for (const leg of legs.values()) {
    const sender = leg.pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(track).catch(() => undefined);
  }
  publish();
}

export async function stopScreenShare(): Promise<void> {
  if (!screenStream) return;
  for (const track of screenStream.getTracks()) track.stop();
  screenStream = null;
  const camera = localStream?.getVideoTracks()[0] ?? null;
  for (const leg of legs.values()) {
    const sender = leg.pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(camera).catch(() => undefined);
  }
  publish();
}
