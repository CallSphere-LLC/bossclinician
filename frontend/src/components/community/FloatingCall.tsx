import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  Loader2,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  PictureInPicture2,
  Send,
  Video,
  VideoOff,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  getIdleSnapshot,
  leaveRoom,
  sendRoomChat,
  setCam,
  setMic,
  subscribeRoom,
  type RemoteParticipant,
  type RoomSnapshot,
} from "@/lib/liveRoom/callManager";

/**
 * The call, while you are somewhere else.
 *
 * The room's engine is module state and was always meant to outlive the room
 * page — but the page was the only thing playing anyone's audio, so walking
 * over to a lesson or the library mid-call meant silence and no way back except
 * the browser's Back button. This sits in the member shell on every other page:
 * it keeps everybody audible, shows who is talking to you, and carries the three
 * controls a person needs without going back — mute, camera, leave — plus the
 * way back, and picture-in-picture for keeping a face on screen over another
 * app or tab. The room's chat comes along too: it opens inside this window, so
 * a conversation started in the room can be finished from a lesson page.
 *
 * It renders nothing on the room page itself, where the full tiles already play
 * the same streams; two elements playing one stream is an echo.
 */

function useRoom(): RoomSnapshot {
  const [room, setRoom] = useState<RoomSnapshot>(getIdleSnapshot);
  useEffect(() => subscribeRoom(setRoom), []);
  return room;
}

/** Plays one remote person's audio. Invisible; one per participant. */
function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }, [stream]);
  return <audio ref={ref} autoPlay className="hidden" />;
}

function pickSpotlight(participants: RemoteParticipant[]): RemoteParticipant | null {
  return (
    participants.find((p) => p.connected && p.stream && p.stream.getVideoTracks().length > 0) ??
    participants.find((p) => p.connected) ??
    participants[0] ??
    null
  );
}

export function FloatingCall() {
  const room = useRoom();
  const { pathname } = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pipOn, setPipOn] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");
  // How many messages had arrived when the chat was last looked at, so the
  // button can say how many are new.
  const [seen, setSeen] = useState(0);
  const chatEnd = useRef<HTMLDivElement>(null);

  const inCall =
    room.slug !== null &&
    (room.status === "waiting" ||
      room.status === "live" ||
      room.status === "connecting" ||
      room.status === "reconnecting");
  const roomPath = room.slug ? `/community/${room.slug}/live` : "";
  const onRoomPage = inCall && pathname === roomPath;
  const show = inCall && !onRoomPage;

  const spotlight = pickSpotlight(room.participants);
  // Somebody else's face if there is one; your own while you wait.
  const shownStream = spotlight?.stream ?? room.localStream;
  const showingSelf = !spotlight?.stream;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== shownStream) el.srcObject = shownStream ?? null;
    if (shownStream) void el.play().catch(() => undefined);
  }, [shownStream, show]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    const enter = () => setPipOn(true);
    const exit = () => setPipOn(false);
    el.addEventListener("enterpictureinpicture", enter);
    el.addEventListener("leavepictureinpicture", exit);
    return () => {
      el.removeEventListener("enterpictureinpicture", enter);
      el.removeEventListener("leavepictureinpicture", exit);
    };
  }, [show]);

  // Leaving the call, or arriving back on the room page, closes a floating window.
  useEffect(() => {
    if (show) return;
    if (typeof document !== "undefined" && document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => undefined);
    }
  }, [show]);

  const messages = room.chat;
  useEffect(() => {
    if (chatOpen && show) {
      setSeen(messages.length);
      chatEnd.current?.scrollIntoView({ block: "end" });
    }
  }, [chatOpen, show, messages.length]);
  // Back on the room page the full chat is on screen, so everything there counts as read.
  useEffect(() => {
    if (onRoomPage) setSeen(messages.length);
  }, [onRoomPage, messages.length]);
  // A new call starts with an empty chat; do not carry the old count over.
  useEffect(() => {
    if (!inCall) {
      setSeen(0);
      setChatOpen(false);
      setDraft("");
    }
  }, [inCall]);

  if (!show) return null;

  const unread = Math.max(0, messages.length - seen);
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    sendRoomChat(text);
    setDraft("");
  };

  const pipSupported =
    typeof document !== "undefined" &&
    "pictureInPictureEnabled" in document &&
    document.pictureInPictureEnabled;

  const togglePip = async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch {
      /* refused by the browser, or no video track to show */
    }
  };

  const others = room.participants.length;
  const line =
    room.status === "reconnecting"
      ? "Reconnecting…"
      : others === 0
        ? "You're the only one here"
        : others === 1
          ? `With ${room.participants[0].name}`
          : `With ${room.participants[0].name} and ${others - 1} more`;

  const control =
    "inline-flex size-11 items-center justify-center rounded-full border border-white/15 text-white/85 " +
    "transition-colors hover:border-white/35 focus-visible:outline focus-visible:outline-2 " +
    "focus-visible:outline-offset-2 focus-visible:outline-gold";

  return (
    <aside
      aria-label="Your call"
      // Dark in both themes: it is a video surface (see site-theme.css).
      data-media-surface
      className="fixed bottom-4 left-4 z-40 w-[min(19rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/15 bg-[#0b0814] text-white shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]"
    >
      {/* Everybody stays audible, whoever is on screen. */}
      {room.participants.map((p) => (
        <RemoteAudio key={p.peerId} stream={p.stream} />
      ))}

      <div className="relative aspect-video bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          // Audio comes from the <audio> elements above, so this never doubles it
          // — and your own picture must never play your own microphone back.
          muted
          className={cn("h-full w-full object-cover", showingSelf && "scale-x-[-1]")}
        />
        {room.status === "reconnecting" && (
          <div className="absolute inset-0 grid place-items-center bg-black/55">
            <Loader2 aria-hidden className="size-6 animate-spin text-gold" />
          </div>
        )}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em]">
          <span aria-hidden className="size-1.5 rounded-full bg-red-500" />
          In a call
        </span>
      </div>

      <div className="px-3.5 pb-3.5 pt-3">
        <p aria-live="polite" className="truncate text-xs text-white/70">
          {line}
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMic(!room.micOn)}
            aria-pressed={!room.micOn}
            aria-label={room.micOn ? "Mute" : "Unmute"}
            title={room.micOn ? "Mute" : "Unmute"}
            className={cn(control, !room.micOn && "border-red-400/60 bg-red-500/20")}
          >
            {room.micOn ? <Mic aria-hidden className="size-4" /> : <MicOff aria-hidden className="size-4" />}
          </button>
          <button
            type="button"
            onClick={() => setCam(!room.camOn)}
            aria-pressed={!room.camOn}
            aria-label={room.camOn ? "Turn camera off" : "Turn camera on"}
            title={room.camOn ? "Turn camera off" : "Turn camera on"}
            className={cn(control, !room.camOn && "border-red-400/60 bg-red-500/20")}
          >
            {room.camOn ? <Video aria-hidden className="size-4" /> : <VideoOff aria-hidden className="size-4" />}
          </button>
          {pipSupported && (
            <button
              type="button"
              onClick={() => void togglePip()}
              aria-pressed={pipOn}
              aria-label={pipOn ? "Close the floating window" : "Pop the video out into a floating window"}
              title={pipOn ? "Close the floating window" : "Float over other tabs and apps"}
              className={cn(control, pipOn && "border-gold/60 bg-gold/20")}
            >
              <PictureInPicture2 aria-hidden className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setChatOpen((open) => !open)}
            aria-expanded={chatOpen}
            aria-label={unread > 0 ? `Chat, ${unread} new` : "Chat"}
            title="Chat"
            className={cn(control, "relative", chatOpen && "border-gold/60 bg-gold/20")}
          >
            <MessageSquare aria-hidden className="size-4" />
            {unread > 0 && !chatOpen && (
              <span className="absolute -right-1 -top-1 grid min-w-[1.15rem] place-items-center rounded-full bg-gold px-1 text-[0.62rem] font-bold text-[#0b0a08]">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
          <Link
            to={roomPath}
            aria-label="Back to the room"
            title="Back to the room"
            className={cn(control, "ml-auto")}
          >
            <Maximize2 aria-hidden className="size-4" />
          </Link>
          <button
            type="button"
            onClick={() => void leaveRoom()}
            aria-label="Leave the call"
            title="Leave the call"
            className="inline-flex size-11 items-center justify-center rounded-full bg-red-500/90 text-white transition-colors hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            <PhoneOff aria-hidden className="size-4" />
          </button>
        </div>

        {chatOpen && (
          <div className="mt-3 border-t border-white/10 pt-3">
            <div
              role="log"
              aria-label="Room chat"
              className="max-h-44 space-y-2 overflow-y-auto pr-1 text-xs"
            >
              {messages.length === 0 ? (
                <p className="text-white/50">Nothing said yet. Chat stays in the room and is not saved.</p>
              ) : (
                messages.map((message) => (
                  <p key={message.id} className="break-words leading-relaxed text-white/85">
                    <span className={cn("font-semibold", message.mine ? "text-gold" : "text-white")}>
                      {message.mine ? "You" : message.name}
                    </span>{" "}
                    {message.text}
                  </p>
                ))
              )}
              <div ref={chatEnd} />
            </div>
            <form
              className="mt-2.5 flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={500}
                placeholder="Say something…"
                aria-label="Message the room"
                className="h-11 min-w-0 flex-1 rounded-full border border-white/15 bg-white/[0.06] px-4 text-sm text-white outline-none placeholder:text-white/40 focus-visible:border-gold/60"
              />
              <button
                type="submit"
                disabled={draft.trim() === ""}
                aria-label="Send"
                className={cn(control, "shrink-0 disabled:opacity-40")}
              >
                <Send aria-hidden className="size-4" />
              </button>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}
