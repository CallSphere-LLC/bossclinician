import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import {
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Send,
  ShieldAlert,
  Video,
  Volume2,
  VolumeX,
  VideoOff,
} from "lucide-react";
import { CommunityLayout } from "@/components/community/CommunityLayout";
import { LiveVideoTile } from "@/components/community/LiveVideoTile";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { GlassCard } from "@/components/luxe/GlassCard";
import { communityApi, type LiveRoomStatus } from "@/lib/communityApi";
import { MemberApiError } from "@/lib/memberApi";
import { useMember } from "@/hooks/useMember";
import { cn } from "@/lib/cn";
import { roomSoundsEnabled, setRoomSoundsEnabled } from "@/lib/liveRoom/chime";
import {
  getIdleSnapshot,
  joinRoom,
  leaveRoom,
  sendRoomChat,
  setCam,
  setMic,
  startScreenShare,
  stopScreenShare,
  subscribeRoom,
  type RoomSnapshot,
} from "@/lib/liveRoom/callManager";
/** "Nobody on the stage, and I meant it" — distinct from never having chosen. */
const UNPINNED = "__none__";

/**
 * The community live room — Yvette's office hours.
 *
 * The call itself lives in a module singleton (`lib/liveRoom/callManager`), so
 * this page is only ever a view of it. That is deliberate: a member who clicks
 * into a channel mid-call should not have their camera torn down by a React
 * unmount, and the only thing that ends a call is pressing Leave.
 *
 * The room is not joined on arrival. A page that grabs a camera the moment it
 * loads is a page nobody opens twice, so this shows who is already inside and
 * waits to be asked.
 */
export default function MemberCommunityLive() {
  const { slug = "" } = useParams();
  return (
    <CommunityLayout slug={slug} activeChannel="live" showSidebar={false}>
      {() => <LiveRoom slug={slug} />}
    </CommunityLayout>
  );
}

function LiveRoom({ slug }: { slug: string }) {
  const { member } = useMember();
  const [room, setRoom] = useState<LiveRoomStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [call, setCall] = useState<RoomSnapshot>(getIdleSnapshot);
  const [draft, setDraft] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => subscribeRoom(setCall), []);

  const refresh = useCallback(async () => {
    try {
      setRoom(await communityApi.liveStatus(slug));
      setLoadError("");
    } catch (err) {
      setLoadError(
        err instanceof MemberApiError
          ? err.message
          : "We couldn't check the room just now. Try again in a moment.",
      );
    }
  }, [slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While outside the room, poll so "Yvette just opened it" arrives without a
  // reload. Inside, presence comes down the signalling stream and polling would
  // be noise.
  const inRoom =
    call.slug === slug &&
    (call.status === "waiting" ||
      call.status === "live" ||
      call.status === "connecting" ||
      // Still in the room as far as this person is concerned: their camera is
      // on, the people they were talking to can usually still hear them, and the
      // page is getting them back in. Showing the join card here would read as
      // "you were thrown out".
      call.status === "reconnecting");
  const reconnecting = call.slug === slug && call.status === "reconnecting";

  // Who is on the stage. A pin is this person's own choice and wins; otherwise
  // whoever is sharing a screen goes up by themselves, which is what people
  // expect when someone says "can you all see this?". UNPINNED records that
  // they took a sharer down on purpose, so the share does not jump back up.
  const [pinnedPeerId, setPinnedPeerId] = useState<string | null>(null);
  // The arrival and departure chimes. On unless this person turned them off.
  const [sounds, setSounds] = useState(roomSoundsEnabled);

  // "You're back" is said once, briefly, and only after a real interruption.
  const [justResumed, setJustResumed] = useState(false);
  const wasReconnecting = useRef(false);
  useEffect(() => {
    if (reconnecting) {
      wasReconnecting.current = true;
      setJustResumed(false);
      return;
    }
    if (wasReconnecting.current && inRoom) {
      wasReconnecting.current = false;
      setJustResumed(true);
      const timer = window.setTimeout(() => setJustResumed(false), 4000);
      return () => window.clearTimeout(timer);
    }
    wasReconnecting.current = false;
    return undefined;
  }, [reconnecting, inRoom]);
  useEffect(() => {
    if (inRoom) return;
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [inRoom, refresh]);

  const join = async () => {
    if (!member) return;
    setJoining(true);
    try {
      await joinRoom({ slug, memberId: member.id, video: true });
    } finally {
      setJoining(false);
      void refresh();
    }
  };

  const leave = async () => {
    await leaveRoom();
    void refresh();
  };

  // Leaving the site should not leave a ghost in the roster. The server drops a
  // peer when its stream closes, but telling it explicitly is faster and makes
  // the tile disappear for everyone else immediately.
  useEffect(() => {
    const onUnload = () => void leaveRoom();
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, []);

  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "end" });
  }, [call.chat.length]);

  const label = room?.label ?? "Live room";

  const others = useMemo(
    () => call.participants.filter((p) => p.peerId !== ""),
    [call.participants],
  );

  /**
   * Inside the room the count comes from the signalling roster, not the polled
   * status — polling stops on join, so the header would otherwise sit on
   * whatever it said at the moment of joining and read "1 of 8" to a room of
   * four.
   */
  const stagePeer = useMemo(() => {
    if (pinnedPeerId === UNPINNED) return null;
    const pinned = pinnedPeerId ? others.find((peer) => peer.peerId === pinnedPeerId) : undefined;
    return pinned ?? others.find((peer) => peer.sharing) ?? null;
  }, [others, pinnedPeerId]);
  // A sharer who stops, or a pinned person who leaves, clears an explicit
  // "off the stage" so the next share is shown again.
  const anyoneSharing = others.some((peer) => peer.sharing);
  useEffect(() => {
    if (!anyoneSharing && pinnedPeerId === UNPINNED) setPinnedPeerId(null);
  }, [anyoneSharing, pinnedPeerId]);

  const occupancy = inRoom ? others.length + 1 : room?.occupancy ?? 0;

  if (loadError) {
    return (
      <GlassCard accent="gold" spotlight={false} interactive={false} className="p-8 text-center">
        <p className="copy-luxe">{loadError}</p>
      </GlassCard>
    );
  }

  if (!room) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 aria-hidden className="size-6 animate-spin text-gold" />
        <span className="sr-only">Checking the room</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-white">{label}</h1>
          <p className="copy-luxe mt-1 text-sm">
            {room.access === "always"
              ? "Open whenever you want to drop in. Video and audio stay between the people in the room."
              : "Opens when Yvette is here."}
          </p>
        </div>
        <p className="text-xs uppercase tracking-[0.14em] text-white/50">
          {occupancy === 0
            ? "Nobody here yet"
            : `${occupancy} of ${room.capacity} in the room`}
        </p>
      </header>

      {!room.open && !inRoom && (
        <GlassCard accent="gold" spotlight={false} interactive={false} className="p-6">
          <p className="copy-luxe text-sm">{room.closedReason}</p>
        </GlassCard>
      )}

      {call.error && (
        <GlassCard accent="gold" spotlight={false} interactive={false} className="p-6">
          <p className="flex items-start gap-3 text-sm text-red-300">
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {call.error}
          </p>
        </GlassCard>
      )}

      {/* A dropped connection is announced, with what is happening about it, in
          the place the eye already is. polite, not assertive: it is not the
          member's job to do anything. */}
      <div aria-live="polite">
        {reconnecting && (
          <p className="flex items-start gap-3 rounded-xl border border-gold/30 bg-gold/[0.08] px-4 py-3 text-sm text-orchid">
            <Loader2 aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-gold" />
            <span>
              <span className="font-semibold text-white">
                {call.online ? "Reconnecting you to the room…" : "You're offline."}
              </span>{" "}
              {call.online
                ? "Your camera and microphone are still on. Stay on this page and the call picks up by itself."
                : "We'll bring you back into the room as soon as your connection returns."}
              {call.reconnectAttempt > 3 && call.online && (
                <span className="block pt-1 text-xs text-orchid-dim">
                  Still trying (attempt {call.reconnectAttempt}). You can also press Leave and join again.
                </span>
              )}
            </span>
          </p>
        )}
        {justResumed && !reconnecting && (
          <p className="rounded-xl border border-gold/30 bg-gold/[0.08] px-4 py-3 text-sm text-orchid">
            <span className="font-semibold text-white">You're back in the room.</span>
          </p>
        )}
      </div>

      {/* Said out loud rather than discovered as a failed call: without a relay
          a few corporate and mobile networks cannot make a direct path. */}
      {inRoom && !call.relayAvailable && (
        <p className="rounded-xl bg-white/[0.04] px-4 py-3 text-xs text-white/60">
          No relay server is configured for this site, so the room needs a
          network that allows a direct connection. Most home and office networks
          do.
        </p>
      )}

      {!inRoom ? (
        <GlassCard accent="gold" spotlight={false} interactive={false} className="space-y-5 p-6 sm:p-8">
          {room.roster.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
                Already in the room
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {room.roster.map((peer) => (
                  <li
                    key={peer.peerId}
                    className="flex min-h-10 items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-sm text-white/80"
                  >
                    {peer.avatarUrl ? (
                      <img src={peer.avatarUrl} alt="" className="size-6 rounded-full object-cover" />
                    ) : (
                      <span className="grid size-6 place-items-center rounded-full bg-ink/10 text-[0.6rem] font-bold">
                        {peer.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    {peer.name}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="copy-luxe text-sm">
              You would be the first one in. Anyone else who joins will see you
              here.
            </p>
          )}

          <LuxeButton
            variant="foil"
            size="md"
            className="min-h-[44px]"
            disabled={joining || room.full || (!room.open && !room.youAreHost)}
            onClick={() => void join()}
          >
            {joining ? "Joining…" : room.full ? "The room is full" : `Join ${label.toLowerCase()}`}
          </LuxeButton>

          <p className="text-xs text-white/45">
            We will ask for your camera and microphone. You can turn either off
            once you are in.
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-4">
            {/* The stage: whoever is showing a screen, or whoever this person
                pinned. A screen is for reading, so it gets the width of the room
                and everyone else moves to a strip underneath. */}
            {stagePeer !== null && (
              <LiveVideoTile
                key={`stage:${stagePeer.peerId}`}
                stage
                stream={stagePeer.stream}
                name={stagePeer.name}
                role={stagePeer.role}
                avatarUrl={stagePeer.avatarUrl}
                connecting={!stagePeer.connected}
                sharing={stagePeer.sharing}
                pinned={pinnedPeerId === stagePeer.peerId}
                onTogglePin={() =>
                  setPinnedPeerId((current) => (current === stagePeer.peerId ? UNPINNED : stagePeer.peerId))
                }
              />
            )}
            <div
              className={cn(
                "grid gap-3",
                stagePeer !== null
                  ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                  : others.length === 0
                    ? "grid-cols-1"
                    : others.length === 1
                      ? "grid-cols-1 sm:grid-cols-2"
                      : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
              )}
            >
              <LiveVideoTile
                stream={call.localStream}
                name={member?.name ?? "You"}
                you
                muted
                mirrored={!call.sharing}
                micOff={!call.micOn}
                sharing={call.sharing}
                role={room.youAreHost ? "host" : "member"}
              />
              {others
                .filter((peer) => peer.peerId !== stagePeer?.peerId)
                .map((peer) => (
                  <LiveVideoTile
                    key={peer.peerId}
                    stream={peer.stream}
                    name={peer.name}
                    role={peer.role}
                    avatarUrl={peer.avatarUrl}
                    connecting={!peer.connected}
                    sharing={peer.sharing}
                    onTogglePin={() => setPinnedPeerId(peer.peerId)}
                  />
                ))}
            </div>

            {others.length === 0 && (
              <p className="copy-luxe text-center text-sm">
                You are the only one here. The room stays open — leave this tab
                on and you will see people arrive.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <RoomControl
                on={call.micOn}
                onLabel="Mute"
                offLabel="Unmute"
                OnIcon={Mic}
                OffIcon={MicOff}
                onClick={() => setMic(!call.micOn)}
              />
              <RoomControl
                on={call.camOn}
                onLabel="Turn camera off"
                offLabel="Turn camera on"
                OnIcon={Video}
                OffIcon={VideoOff}
                onClick={() => setCam(!call.camOn)}
              />
              <button
                type="button"
                onClick={() => void (call.sharing ? stopScreenShare() : startScreenShare())}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                  call.sharing
                    ? "border-gold/50 bg-gold/15 text-gold"
                    : "border-white/15 text-white/80 hover:border-white/30",
                )}
              >
                <MonitorUp aria-hidden className="size-4" />
                {call.sharing ? "Stop sharing" : "Share screen"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRoomSoundsEnabled(!sounds);
                  setSounds(!sounds);
                }}
                aria-pressed={sounds}
                title={sounds ? "A sound plays when someone joins or leaves" : "Join and leave sounds are off"}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                  sounds
                    ? "border-white/15 text-white/80 hover:border-white/30"
                    : "border-white/15 text-white/50 hover:border-white/30",
                )}
              >
                {sounds ? <Volume2 aria-hidden className="size-4" /> : <VolumeX aria-hidden className="size-4" />}
                {sounds ? "Sounds on" : "Sounds off"}
              </button>
              <button
                type="button"
                onClick={() => void leave()}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-red-500/90 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-500"
              >
                <PhoneOff aria-hidden className="size-4" />
                Leave
              </button>
            </div>
          </div>

          <GlassCard
            accent="plum"
            spotlight={false}
            interactive={false}
            className="flex max-h-[32rem] flex-col p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
              In-room chat
            </p>
            <div className="mt-3 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
              {call.chat.length === 0 ? (
                <p className="text-xs text-white/45">
                  Nothing said yet. Chat here stays in the room and is not saved.
                </p>
              ) : (
                call.chat.map((message) => (
                  <div key={message.id} className="break-words text-sm">
                    <span
                      className={cn(
                        "font-semibold",
                        message.mine ? "text-gold" : "text-white/80",
                      )}
                    >
                      {message.mine ? "You" : message.name}
                    </span>
                    <span className="ml-2 text-white/70">{message.text}</span>
                  </div>
                ))
              )}
              <div ref={chatEnd} />
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                sendRoomChat(draft);
                setDraft("");
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Say something…"
                aria-label="Message the room"
                maxLength={500}
                className="h-11 min-w-0 flex-1 rounded-xl border border-white/12 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
              />
              <button
                type="submit"
                disabled={draft.trim().length === 0}
                aria-label="Send"
                className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/12 text-white/80 disabled:opacity-40"
              >
                <Send aria-hidden className="size-4" />
              </button>
            </form>
          </GlassCard>
        </div>
      )}
    </div>
  );
}

/** A mic/camera toggle, sized to the 40px floor the rest of the app now holds. */
function RoomControl({
  on,
  onLabel,
  offLabel,
  OnIcon,
  OffIcon,
  onClick,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  OnIcon: typeof Mic;
  OffIcon: typeof MicOff;
  onClick: () => void;
}) {
  const Icon = on ? OnIcon : OffIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!on}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
        on
          ? "border-white/15 text-white/80 hover:border-white/30"
          : "border-red-400/40 bg-red-500/15 text-red-200",
      )}
    >
      <Icon aria-hidden className="size-4" />
      {on ? onLabel : offLabel}
    </button>
  );
}
