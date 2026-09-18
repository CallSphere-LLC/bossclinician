import { useEffect, useRef } from "react";
import { MicOff, ScreenShare, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * One person in the room.
 *
 * A `<video>` element cannot be given a `MediaStream` through a React prop —
 * `srcObject` is a property, not an attribute — so the stream is attached in an
 * effect. It is also re-attached whenever the stream identity changes, because a
 * peer who turns their camera off and on again arrives as a different object and
 * a tile that only attached once would freeze on the last frame.
 */
export function LiveVideoTile({
  stream,
  name,
  role,
  avatarUrl,
  muted = false,
  mirrored = false,
  connecting = false,
  micOff = false,
  sharing = false,
  you = false,
}: {
  stream: MediaStream | null;
  name: string;
  role?: string;
  avatarUrl?: string;
  /** Always true for your own tile, or you hear yourself with a delay. */
  muted?: boolean;
  /** Your own camera reads as a mirror; a remote one must not. */
  mirrored?: boolean;
  connecting?: boolean;
  micOff?: boolean;
  sharing?: boolean;
  you?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) {
      // Autoplay can still be refused when the tab has had no interaction; the
      // catch keeps that from throwing an unhandled rejection into the console.
      void el.play().catch(() => undefined);
    }
  }, [stream]);

  const hasVideo = stream !== null && stream.getVideoTracks().some((t) => t.enabled);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  const isHost = role === "host" || role === "owner" || role === "moderator";

  return (
    <div
      data-media-surface
      className={cn(
        "relative aspect-video overflow-hidden rounded-2xl border bg-[#06040b]",
        sharing ? "border-gold/50" : "border-white/10",
      )}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={cn(
          "size-full object-cover",
          mirrored && "scale-x-[-1]",
          !hasVideo && "opacity-0",
        )}
      />

      {!hasVideo && (
        <div className="absolute inset-0 grid place-items-center">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className="size-20 rounded-full object-cover opacity-90"
            />
          ) : (
            <span className="grid size-20 place-items-center rounded-full bg-white/[0.08] font-display text-2xl text-white/70">
              {initials || "?"}
            </span>
          )}
        </div>
      )}

      {connecting && (
        <div className="absolute inset-0 grid place-items-center bg-black/40">
          <span className="flex items-center gap-2 text-xs font-semibold text-white/80">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Connecting…
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">
          {you ? "You" : name}
          {isHost && <span className="ml-1.5 text-[0.6rem] uppercase text-gold">Host</span>}
        </span>
        {sharing && <ScreenShare aria-label="Sharing their screen" className="size-3.5 text-gold" />}
        {micOff && <MicOff aria-label="Microphone off" className="size-3.5 text-white/60" />}
      </div>
    </div>
  );
}
