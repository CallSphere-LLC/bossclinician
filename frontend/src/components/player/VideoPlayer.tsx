import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { ProgressResult } from "@/lib/libraryApi";
import { SpeedControl, useStoredPlaybackRate } from "@/components/player/SpeedControl";
import { useMediaKeys } from "@/components/player/useMediaKeys";
import { useMediaProgress } from "@/components/player/useMediaProgress";

interface VideoPlayerProps {
  lessonId: number;
  src: string;
  captionsUrl: string;
  poster: string;
  title: string;
  startAt: number;
  initialPercent: number;
  onSaved: (result: ProgressResult) => void;
}

/**
 * The video lesson.
 *
 * Native `controls` rather than a hand-built control bar. Everything a custom
 * bar would have to reimplement — the scrub handle's touch target, buffered
 * ranges, fullscreen, Picture-in-Picture, AirPlay, the caption menu, and every
 * one of those reachable by keyboard and named to a screen reader — the platform
 * already ships correct. What the platform does *not* offer consistently is a
 * speed control, which is why that one is ours.
 */
export function VideoPlayer({
  lessonId,
  src,
  captionsUrl,
  poster,
  title,
  startAt,
  initialPercent,
  onSaved,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [rate, setRate] = useStoredPlaybackRate();

  useMediaProgress({ media: videoRef, lessonId, startAt, initialPercent, onSaved });
  useMediaKeys(videoRef, true);

  // Reapplied on every source change: `playbackRate` is a property of the
  // element, and loading a new lesson into a fresh one resets it to 1.
  useEffect(() => {
    const el = videoRef.current;
    if (el) el.playbackRate = rate;
  }, [rate, src]);

  if (!src) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-8 text-center text-sm text-orchid-dim">
        This lesson&rsquo;s video is not available yet. Please check back shortly.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-glass">
        <video
          ref={videoRef}
          src={src}
          poster={poster || undefined}
          controls
          playsInline
          preload="metadata"
          // Neither auto: metadata alone is enough to resume from, and a course
          // page that starts making noise on its own is the fastest way to be
          // closed. `playsInline` keeps iOS from hijacking the whole screen.
          className="aspect-video w-full bg-black"
          aria-label={title}
        >
          {captionsUrl && (
            <track kind="captions" src={captionsUrl} srcLang="en" label="English" default />
          )}
        </video>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <SpeedControl rate={rate} onChange={setRate} />
        <KeyboardHint className="hidden sm:block" />
      </div>
    </div>
  );
}

/**
 * The shortcuts, written down.
 *
 * Hidden below `sm` because a phone has no keyboard and the line would just be
 * clutter above the fold on the screen where space is tightest.
 */
export function KeyboardHint({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-orchid-faint", className)}>
      <Key>Space</Key> play or pause &middot; <Key>&larr;</Key> <Key>&rarr;</Key> skip 5 seconds
      &middot; <Key>M</Key> mute &middot; <Key>F</Key> full screen
    </p>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-white/15 bg-white/[0.06] px-1.5 py-0.5 font-body text-[0.68rem] text-orchid">
      {children}
    </kbd>
  );
}
