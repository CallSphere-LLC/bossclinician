import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Loader2,
  Maximize,
  MicOff,
  Minimize,
  Pin,
  PinOff,
  RotateCcw,
  ScreenShare,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * One person in the room.
 *
 * A `<video>` element cannot be given a `MediaStream` through a React prop —
 * `srcObject` is a property, not an attribute — so the stream is attached in an
 * effect. It is also re-attached whenever the stream identity changes, because a
 * peer who turns their camera off and on again arrives as a different object and
 * a tile that only attached once would freeze on the last frame.
 *
 * A face and a shared screen want opposite things. A face fills its tile and
 * loses its edges happily (`object-cover`). A screen has to be seen whole, large
 * enough to read, and sometimes closer than that — so a tile on the stage, or a
 * tile showing a screen, is letterboxed (`object-contain`), can go full screen,
 * and can be zoomed and dragged around like a map.
 */

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.5;

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
  stage = false,
  pinned = false,
  onTogglePin,
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
  /** The large tile at the top of the room. */
  stage?: boolean;
  pinned?: boolean;
  /** Present when this tile may be put on, or taken off, the stage. */
  onTogglePin?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

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

  useEffect(() => {
    const onChange = () => {
      const on = document.fullscreenElement === frame.current;
      setFullscreen(on);
      if (!on) {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = frame.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) await document.exitFullscreen();
      else if (el.requestFullscreen) await el.requestFullscreen();
      else {
        // iPhone Safari only lets the <video> itself go full screen.
        const video = ref.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
        video?.webkitEnterFullscreen?.();
      }
    } catch {
      /* refused by the browser; the tile stays as it is */
    }
  }, []);

  /** Keeps the picture from being dragged clean out of its frame. */
  const clamp = useCallback((next: { x: number; y: number }, scale: number) => {
    const el = frame.current;
    if (!el || scale <= 1) return { x: 0, y: 0 };
    const maxX = (el.clientWidth * (scale - 1)) / 2;
    const maxY = (el.clientHeight * (scale - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }, []);

  const setZoomTo = useCallback(
    (value: number) => {
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value * 100) / 100));
      setZoom(next);
      setOffset((current) => clamp(current, next));
    },
    [clamp],
  );

  const hasVideo = stream !== null && stream.getVideoTracks().some((t) => t.enabled);
  // Whole picture, zoomable: a shared screen anywhere, anything on the stage,
  // and anything in full screen.
  const detailed = hasVideo && (sharing || stage || fullscreen);
  const zoomable = detailed;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!zoomable || zoom <= 1) return;
    if ((event.target as HTMLElement).closest("button")) return;
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    setOffset(clamp({ x: start.ox + (event.clientX - start.x), y: start.oy + (event.clientY - start.y) }, zoom));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  // Ctrl/⌘ + wheel zooms, like a map or a document viewer; a bare wheel still
  // scrolls the page. Registered natively because React's wheel listener is
  // passive and cannot stop the browser's own page zoom.
  useEffect(() => {
    const el = frame.current;
    if (!el || !zoomable) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) && document.fullscreenElement !== el) return;
      event.preventDefault();
      setZoomTo(zoom + (event.deltaY < 0 ? ZOOM_STEP / 2 : -ZOOM_STEP / 2));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomable, zoom, setZoomTo]);

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  const isHost = role === "host" || role === "owner" || role === "moderator";
  const label = you ? "You" : name;

  const tool =
    "inline-flex size-9 items-center justify-center rounded-full bg-black/60 text-white/90 backdrop-blur " +
    "transition-colors hover:bg-black/80 focus-visible:outline focus-visible:outline-2 " +
    "focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-40";

  return (
    <div
      ref={frame}
      data-media-surface
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        void toggleFullscreen();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={cn(
        "group/tile relative overflow-hidden rounded-2xl border bg-[#06040b]",
        // The stage is as large as the screen allows without pushing the
        // controls off it; an ordinary tile keeps the 16:9 box.
        stage && !fullscreen ? "aspect-video max-h-[72vh] w-full" : "aspect-video",
        fullscreen && "aspect-auto h-screen w-screen rounded-none border-0",
        sharing ? "border-gold/50" : "border-white/10",
        zoomable && zoom > 1 && "cursor-grab active:cursor-grabbing",
      )}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        style={
          zoomable && zoom !== 1
            ? { transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }
            : undefined
        }
        className={cn(
          "size-full transition-transform duration-100 ease-out",
          detailed ? "object-contain" : "object-cover",
          mirrored && !detailed && "scale-x-[-1]",
          !hasVideo && "opacity-0",
        )}
      />

      {!hasVideo && (
        <div className="absolute inset-0 grid place-items-center">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="size-20 rounded-full object-cover opacity-90" />
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

      {/* Tile controls: visible on hover and on keyboard focus, always visible on
          touch screens (no hover there) and in full screen. */}
      <div
        className={cn(
          "absolute right-2 top-2 z-[2] flex items-center gap-1.5 transition-opacity duration-150",
          "opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/tile:opacity-100",
          "[@media(hover:hover)]:group-focus-within/tile:opacity-100",
          fullscreen && "!opacity-100",
        )}
      >
        {zoomable && (
          <>
            <button
              type="button"
              onClick={() => setZoomTo(zoom - ZOOM_STEP)}
              disabled={zoom <= ZOOM_MIN}
              aria-label="Zoom out"
              title="Zoom out"
              className={tool}
            >
              <ZoomOut aria-hidden className="size-4" />
            </button>
            <span
              aria-live="polite"
              className="min-w-[3rem] rounded-full bg-black/60 px-2 py-1.5 text-center text-[0.68rem] font-semibold tabular-nums text-white/90 backdrop-blur"
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoomTo(zoom + ZOOM_STEP)}
              disabled={zoom >= ZOOM_MAX}
              aria-label="Zoom in"
              title="Zoom in (or hold Ctrl and scroll)"
              className={tool}
            >
              <ZoomIn aria-hidden className="size-4" />
            </button>
            {zoom !== 1 && (
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setOffset({ x: 0, y: 0 });
                }}
                aria-label="Reset zoom"
                title="Reset zoom"
                className={tool}
              >
                <RotateCcw aria-hidden className="size-4" />
              </button>
            )}
          </>
        )}
        {onTogglePin && !fullscreen && (
          <button
            type="button"
            onClick={onTogglePin}
            aria-pressed={pinned}
            aria-label={pinned ? `Take ${label} off the stage` : `Put ${label} on the stage`}
            title={pinned ? "Unpin" : "Pin to the top"}
            className={cn(tool, pinned && "bg-gold/80 text-[#0b0a08] hover:bg-gold")}
          >
            {pinned ? <PinOff aria-hidden className="size-4" /> : <Pin aria-hidden className="size-4" />}
          </button>
        )}
        {hasVideo && (
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-pressed={fullscreen}
            aria-label={fullscreen ? "Leave full screen" : `Show ${label} full screen`}
            title={fullscreen ? "Leave full screen (Esc)" : "Full screen (or double-click)"}
            className={tool}
          >
            {fullscreen ? <Minimize aria-hidden className="size-4" /> : <Maximize aria-hidden className="size-4" />}
          </button>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-[1] flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">
          {label}
          {isHost && <span className="ml-1.5 text-[0.6rem] uppercase text-gold">Host</span>}
          {sharing && <span className="ml-1.5 text-[0.6rem] uppercase text-gold">Sharing their screen</span>}
        </span>
        {sharing && <ScreenShare aria-label="Sharing a screen" className="size-3.5 text-gold" />}
        {micOff && <MicOff aria-label="Microphone off" className="size-3.5 text-white/60" />}
      </div>
    </div>
  );
}
