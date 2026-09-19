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

import { getAccessToken, MemberApiError, memberFetch } from "@/lib/memberApi";
import { playChime, primeChime } from "./chime";

/** Matches memberApi so a deployment that moves the API moves this with it. */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export type RoomStatus =
  | "idle"
  | "connecting" // acquiring devices, ICE config and the signalling stream
  | "waiting" // in the room, nobody else here yet
  | "live" // at least one peer connected
  | "reconnecting" // the signalling stream dropped; media keeps flowing while we get back in
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
  /** True while what they are sending is a screen rather than a camera. */
  sharing: boolean;
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
  /** First successful connection; retained across page changes and reconnects. */
  joinedAt: number | null;
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
  /** Which try this is while `status` is "reconnecting"; 0 otherwise. */
  reconnectAttempt: number;
  /** False while the browser reports no network at all. */
  online: boolean;
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
  /** They told us they are showing a screen (a "net" signal; see announceSharing). */
  sharing: boolean;
  /** Perfect-negotiation flags, per leg — they cannot be shared across peers. */
  makingOffer: boolean;
  ignoreOffer: boolean;
  polite: boolean;
}

/* ------------------------------------------------------------ module state */

let slug: string | null = null;
let status: RoomStatus = "idle";
let joinedAt: number | null = null;
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

/* Resuming a call. Media is peer to peer, so a dropped signalling stream — a
   server restart, a lift, a laptop lid — does not by itself stop anyone being
   seen or heard. What it stops is negotiation. The rules below are the usual
   ones for a call that is meant to survive that:
     - keep the peer connections and the camera exactly as they are;
     - get back in with capped exponential backoff and jitter, so a room full of
       people does not retry a restarting server in lockstep;
     - retry at once when the network or the tab comes back;
     - give up only on an answer that will never change (no access, room closed),
       or after a long time;
     - once back, let the roster settle before believing anyone has left. */
let reconnectAttempt = 0;
let reconnectTimer: number | null = null;
let reconnectSince = 0;
let lastEventAt = 0;
let watchdog: number | null = null;
/** Until this time a roster that omits a still-connected peer is not believed. */
let resyncUntil = 0;
let pruneTimer: number | null = null;
let listening = false;

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 15_000;
/** After this long without getting back in, stop and say so. */
const GIVE_UP_AFTER_MS = 5 * 60_000;
/** The server pings every 25s; two missed pings and the stream is treated as dead. */
const STREAM_SILENCE_MS = 60_000;
/** How long everyone else gets to reappear after we do. */
const RESYNC_GRACE_MS = 20_000;
/** "disconnected" often heals by itself; past this, ask ICE to start over. */
const ICE_DISCONNECTED_GRACE_MS = 4_000;

const legs = new Map<string, PeerLeg>();
const listeners = new Set<(snapshot: RoomSnapshot) => void>();

function idle(): RoomSnapshot {
  return {
    slug: null,
    joinedAt: null,
    status: "idle",
    error: null,
    localStream: null,
    participants: [],
    micOn: true,
    camOn: true,
    sharing: false,
    chat: [],
    relayAvailable: false,
    reconnectAttempt: 0,
    online: true,
  };
}

function snapshot(): RoomSnapshot {
  return {
    slug,
    joinedAt,
    status,
    error,
    localStream,
    participants: [...legs.values()].map((leg) => ({
      ...leg.info,
      stream: leg.stream,
      connected: leg.connected,
      sharing: leg.sharing,
    })),
    micOn,
    camOn,
    sharing: screenStream !== null,
    chat,
    relayAvailable,
    reconnectAttempt: status === "reconnecting" ? reconnectAttempt : 0,
    online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
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
    sharing: false,
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
    if (state === "disconnected") {
      // A Wi-Fi to mobile handover looks like this. It usually heals within a
      // second or two; if it has not, new candidates are what it needs.
      window.setTimeout(() => {
        if (legs.get(info.peerId) !== leg) return;
        if (pc.connectionState === "disconnected") {
          try {
            pc.restartIce();
          } catch {
            /* as above */
          }
        }
      }, ICE_DISCONNECTED_GRACE_MS);
    }
    if (state === "closed") legs.delete(info.peerId);
    recomputeStatus();
    publish();
  };

  return leg;
}

function recomputeStatus(): void {
  if (status === "idle" || status === "left" || status === "error") return;
  // No signalling stream means we are on our way back in, whatever the media is
  // doing. Saying "live" here would hide that nobody new can reach us.
  if (source === null && slug !== null && reconnectSince !== 0) {
    status = "reconnecting";
    return;
  }
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

let latestRoster: RosterEntry[] | null = null;
/** Who we have already announced, so a roster re-send is not a second chime. */
const announced = new Set<string>();
/** The first roster is who was already here — nobody "arrived". */
let rosterBaselined = false;

/** Arrival and departure sounds, from the difference between two rosters. */
function chimeForRoster(present: Set<string>): void {
  // While the room is refilling after a reconnect, people reappearing are not
  // arriving and people not yet back have not left.
  const settling = Date.now() < resyncUntil;
  if (!rosterBaselined) {
    rosterBaselined = true;
    for (const id of present) announced.add(id);
    return;
  }
  let arrived = false;
  let departed = false;
  for (const id of present) {
    if (!announced.has(id)) {
      announced.add(id);
      arrived = true;
    }
  }
  if (!settling) {
    for (const id of [...announced]) {
      if (!present.has(id)) {
        announced.delete(id);
        departed = true;
      }
    }
  }
  if (settling) return;
  if (arrived) playChime("join");
  else if (departed) playChime("leave");
}

function onPresence(roster: RosterEntry[]): void {
  const present = new Set<string>();
  for (const entry of roster) {
    if (entry.peerId === myPeerId) continue;
    present.add(entry.peerId);
    const isNew = !legs.has(entry.peerId);
    const leg = openLeg(entry);
    // Somebody who walks in mid-presentation has not heard the announcement.
    if (isNew && screenStream) void post("net", entry.peerId, { sharing: true });
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

  chimeForRoster(present);

  // Anybody the server no longer lists has gone. Closing here rather than
  // waiting for ICE to fail is what makes a tile vanish promptly — except just
  // after we have come back. A restarted server starts with an empty room and
  // fills up as each browser returns, so the first rosters are short by
  // everyone who is a second behind us, and their media is still flowing.
  const settling = Date.now() < resyncUntil;
  for (const peerId of [...legs.keys()]) {
    if (present.has(peerId)) continue;
    const leg = legs.get(peerId);
    if (settling && leg && leg.pc.connectionState === "connected") continue;
    closeLeg(peerId);
  }
  if (settling && pruneTimer === null) {
    const roster_ = roster;
    pruneTimer = window.setTimeout(() => {
      pruneTimer = null;
      resyncUntil = 0;
      // Whoever has still not reappeared really has gone.
      if (slug !== null && source !== null) onPresence(latestRoster ?? roster_);
    }, Math.max(0, resyncUntil - Date.now()) + 50);
  }
  latestRoster = roster;

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
    if (announced.delete(signal.senderId)) playChime("leave");
    closeLeg(signal.senderId);
    recomputeStatus();
    publish();
    return;
  }

  const leg = legs.get(signal.senderId);
  if (!leg) return; // a signal from somebody presence has not introduced yet

  if (signal.kind === "net") {
    // A screen and a camera arrive on the same video track, so the picture alone
    // cannot say which it is — and the room lays a screen out very differently.
    const payload = signal.payload as { sharing?: unknown } | undefined;
    if (typeof payload?.sharing === "boolean" && leg.sharing !== payload.sharing) {
      leg.sharing = payload.sharing;
      publish();
    }
    return;
  }

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

/** True while this tab is meant to be in a room (joined, not left, not failed). */
function wantsRoom(): boolean {
  return slug !== null && status !== "idle" && status !== "left" && status !== "error";
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function dropStream(): void {
  if (source) {
    source.onerror = null;
    source.onopen = null;
    source.close();
    source = null;
  }
}

/** An answer that will be the same however often it is asked. */
function isFatal(err: unknown): err is MemberApiError {
  return err instanceof MemberApiError && [400, 403, 404, 409, 410].includes(err.status);
}

function fail(message: string): void {
  clearReconnectTimer();
  dropStream();
  reconnectSince = 0;
  reconnectAttempt = 0;
  status = "error";
  error = message;
  publish();
}

/**
 * Schedules the next attempt to get back in.
 *
 * Full-jitter exponential backoff: 1s, 2s, 4s, 8s, then every 15s, each
 * multiplied by a random 0.5 to 1. A restart drops every browser in the room at
 * the same instant; without the jitter they would all return at the same instant
 * too. `soon` is for the moments when waiting is pointless — the network just
 * came back, the tab just became visible, the server said it is restarting.
 */
function scheduleReconnect(soon = false): void {
  if (!wantsRoom() && status !== "reconnecting") return;
  clearReconnectTimer();
  dropStream();

  if (reconnectSince === 0) reconnectSince = Date.now();
  if (Date.now() - reconnectSince > GIVE_UP_AFTER_MS) {
    fail("We lost the connection to the room and could not get it back. Press Join to come back in.");
    return;
  }

  status = "reconnecting";
  error = null;
  publish();

  const exponential = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** reconnectAttempt);
  const delay = soon ? 250 + Math.random() * 750 : exponential * (0.5 + Math.random() * 0.5);
  reconnectAttempt += 1;

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (status === "reconnecting") void openStream();
  }, delay);
}

/** TURN credentials are short-lived; a resumed call gets fresh ones. */
async function loadIceConfig(): Promise<void> {
  if (!slug) return;
  try {
    const res = await memberFetch(`/member/community/${encodeURIComponent(slug)}/live/ice`);
    const body = (await res.json()) as { iceServers?: RTCIceServer[]; turn?: boolean };
    iceServers = body.iceServers ?? [];
    relayAvailable = body.turn === true;
    for (const leg of legs.values()) {
      try {
        leg.pc.setConfiguration({ iceServers });
      } catch {
        /* a closed connection, or a browser that will not change it mid-call */
      }
    }
  } catch {
    // Keep whatever we had. No ICE config at all still leaves host candidates,
    // which work on one network.
  }
}

/**
 * Opens the signalling stream.
 *
 * `EventSource` cannot send an Authorization header, so rather than putting the
 * member's access token in a URL — where nginx logs it — we swap it for a
 * one-minute single-use ticket first and connect with that. The ticket request
 * goes through `memberFetch`, so an access token that expired during a long
 * call is refreshed instead of ending it.
 */
async function openStream(): Promise<void> {
  if (!slug) return;
  const forSlug = slug;
  let minted: { ticket: string; peerId: string };
  try {
    const res = await memberFetch(`/member/community/${encodeURIComponent(forSlug)}/live/ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peerId: rawPeerId }),
    });
    minted = (await res.json()) as { ticket: string; peerId: string };
  } catch (err) {
    if (slug !== forSlug) return; // left, or moved rooms, while this was in flight
    if (err instanceof MemberApiError && err.status === 401) {
      fail("You have been signed out. Sign in again to come back to the room.");
    } else if (isFatal(err)) {
      fail(err.message || "We couldn't get you into the room.");
    } else {
      // A 5xx, a 429, a timeout, no network: all of them pass.
      scheduleReconnect();
    }
    return;
  }
  if (slug !== forSlug || !wantsRoom()) return;

  // The server's own binding, so echo filtering and politeness both agree with
  // the ids it stamps on relayed signals.
  myPeerId = minted.peerId;

  dropStream();
  const query = new URLSearchParams({ ticket: minted.ticket, peerId: minted.peerId });
  const stream = new EventSource(`${API_BASE}/community-live/stream?${query.toString()}`);
  source = stream;
  lastEventAt = Date.now();

  stream.onopen = () => {
    if (source !== stream) return;
    joinedAt ??= Date.now();
    lastEventAt = Date.now();
    const resumed = reconnectSince !== 0;
    reconnectAttempt = 0;
    reconnectSince = 0;
    if (resumed) {
      resyncUntil = Date.now() + RESYNC_GRACE_MS;
      void loadIceConfig();
      // Anything that failed while nobody could negotiate gets another go now.
      for (const leg of legs.values()) {
        if (leg.pc.connectionState === "failed" || leg.pc.connectionState === "disconnected") {
          try {
            leg.pc.restartIce();
          } catch {
            /* rebuilt by presence if it cannot */
          }
        }
      }
    }
    if (status === "reconnecting") status = "waiting";
    recomputeStatus();
    publish();
  };
  stream.addEventListener("signal", (event) => {
    lastEventAt = Date.now();
    try {
      handleSignal(JSON.parse((event as MessageEvent).data) as IncomingSignal);
    } catch {
      /* a malformed frame is not worth ending a call over */
    }
  });
  stream.addEventListener("ping", () => {
    lastEventAt = Date.now();
  });
  stream.addEventListener("shutdown", () => {
    // The server is restarting and said so. Come back quickly, but not all at once.
    if (source === stream) scheduleReconnect(true);
  });
  stream.onerror = () => {
    // A ticket is single-use, so EventSource's built-in retry would replay a
    // spent one and be refused forever. Close it and re-mint instead — the
    // server holds our place for a few seconds, so a brief drop is not
    // announced to the room as a departure.
    if (source !== stream) return;
    if (!wantsRoom() && status !== "reconnecting") return;
    scheduleReconnect();
  };
}

function onOnline(): void {
  publish();
  if (status === "reconnecting") scheduleReconnect(true);
}

function onOffline(): void {
  publish();
  // The stream will error shortly; saying so now is kinder than a frozen room.
  if (wantsRoom()) scheduleReconnect();
}

function onVisible(): void {
  if (document.visibilityState !== "visible") return;
  // A phone that slept the tab may have a stream the OS killed without telling
  // it. If the server has gone quiet, do not wait for the watchdog.
  if (status === "reconnecting") scheduleReconnect(true);
  else if (wantsRoom() && source && Date.now() - lastEventAt > STREAM_SILENCE_MS) scheduleReconnect(true);
}

function startResumeWatchers(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);
  watchdog = window.setInterval(() => {
    if (wantsRoom() && source && Date.now() - lastEventAt > STREAM_SILENCE_MS) scheduleReconnect(true);
  }, 10_000);
}

function stopResumeWatchers(): void {
  if (!listening) return;
  listening = false;
  window.removeEventListener("online", onOnline);
  window.removeEventListener("offline", onOffline);
  document.removeEventListener("visibilitychange", onVisible);
  if (watchdog !== null) window.clearInterval(watchdog);
  watchdog = null;
}

export interface JoinRoomOptions {
  slug: string;
  memberId: number;
  /** Start with the camera off — the room is often joined to listen. */
  video?: boolean;
}

export async function joinRoom(options: JoinRoomOptions): Promise<void> {
  if (slug === options.slug && status !== "idle" && status !== "left" && status !== "error") {
    // Already in this room. If we were on our way back in, pressing Join again
    // means "now, please".
    if (status === "reconnecting") scheduleReconnect(true);
    return;
  }
  // Before the first await: this runs inside the Join click, which is what lets
  // the browser play the arrival and departure sounds later.
  primeChime();
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

  await loadIceConfig();

  rawPeerId = randomId();
  status = "waiting";
  reconnectAttempt = 0;
  reconnectSince = 0;
  resyncUntil = 0;
  publish();
  startResumeWatchers();
  await openStream();
}

export async function leaveRoom(): Promise<void> {
  clearReconnectTimer();
  stopResumeWatchers();
  if (pruneTimer !== null) window.clearTimeout(pruneTimer);
  pruneTimer = null;
  latestRoster = null;
  announced.clear();
  rosterBaselined = false;
  reconnectAttempt = 0;
  reconnectSince = 0;
  resyncUntil = 0;
  dropStream();
  if (slug && rawPeerId) void post("bye", "");

  for (const peerId of [...legs.keys()]) closeLeg(peerId);

  for (const track of localStream?.getTracks() ?? []) track.stop();
  for (const track of screenStream?.getTracks() ?? []) track.stop();
  localStream = null;
  screenStream = null;

  slug = null;
  joinedAt = null;
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
    // Text is what a shared screen is for: ask for the full resolution and a
    // modest frame rate rather than the camera-style defaults.
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } },
      audio: false,
    });
  } catch {
    return; // the picker was dismissed
  }
  const track = screenStream.getVideoTracks()[0];
  if (!track) return;
  // "detail" tells the encoder to keep edges sharp and drop frames instead when
  // bandwidth is short — the opposite of what suits a face.
  try {
    track.contentHint = "detail";
  } catch {
    /* not supported everywhere; the share still works */
  }
  // The browser's own "Stop sharing" button ends the track without telling us.
  track.addEventListener("ended", () => void stopScreenShare());
  for (const leg of legs.values()) {
    const sender = leg.pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender) {
      await sender.replaceTrack(track).catch(() => undefined);
      try {
        const parameters = sender.getParameters();
        parameters.degradationPreference = "maintain-resolution";
        await sender.setParameters(parameters);
      } catch {
        /* a browser that will not take the hint */
      }
    }
  }
  void post("net", "", { sharing: true });
  publish();
}

export async function stopScreenShare(): Promise<void> {
  if (!screenStream) return;
  for (const track of screenStream.getTracks()) track.stop();
  screenStream = null;
  const camera = localStream?.getVideoTracks()[0] ?? null;
  for (const leg of legs.values()) {
    const sender = leg.pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender) {
      await sender.replaceTrack(camera).catch(() => undefined);
      try {
        const parameters = sender.getParameters();
        parameters.degradationPreference = "balanced";
        await sender.setParameters(parameters);
      } catch {
        /* as above */
      }
    }
  }
  void post("net", "", { sharing: false });
  publish();
}
