import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Captions } from "lucide-react";
import { cn } from "@/lib/cn";
import type { FullWatchState, ProgressResult } from "@/lib/libraryApi";
import { SpeedControl, useStoredPlaybackRate } from "@/components/player/SpeedControl";
import { useMediaKeys } from "@/components/player/useMediaKeys";
import { useMediaProgress } from "@/components/player/useMediaProgress";
import { useRenewableSource } from "@/components/player/useRenewableSource";

interface VideoPlayerProps {
  lessonId: number;
  src: string;
  captionsUrl: string;
  poster: string;
  title: string;
  startAt: number;
  initialPercent: number;
  /** "Require watching the full video before the next lesson", when it applies. */
  fullWatch?: FullWatchState;
  onSaved: (result: ProgressResult) => void;
}

/* ------------------------------------------------------------- captions (CC) */

const CAPTIONS_KEY = "bc.player.captions";

/** Off unless this device has turned them on before. */
function readCaptionsPreference(): boolean {
  try {
    return window.localStorage.getItem(CAPTIONS_KEY) === "on";
  } catch {
    return false;
  }
}

function storeCaptionsPreference(on: boolean): void {
  try {
    window.localStorage.setItem(CAPTIONS_KEY, on ? "on" : "off");
  } catch {
    // Applies to this session; it just will not be remembered.
  }
}

/**
 * Whether the caption file lives on another origin. A cross-origin <track> is
 * only loaded when the <video> itself is in CORS mode, which in turn breaks a
 * video on a host that sends no CORS headers — so CORS mode is asked for only
 * when the captions need it and the video is ours. Signed /api/files links and
 * /uploads paths are same-origin, so in practice this is false.
 */
function needsCorsForCaptions(captionsUrl: string, src: string): boolean {
  try {
    const here = window.location.origin;
    const captions = new URL(captionsUrl, here).origin;
    const video = new URL(src, here).origin;
    return captions !== here && video === here;
  } catch {
    return false;
  }
}

/**
 * Captions on or off, kept in step with the native controls' own caption menu.
 *
 * The track is loaded with mode "hidden" rather than "disabled" so the browser
 * fetches the cues and turning them on is instant; "showing" draws them. A
 * change made from the native menu fires `change` on the track list, and that
 * is read back so the CC button never disagrees with what is on screen.
 */
function useCaptions(
  videoRef: RefObject<HTMLVideoElement | null>,
  captionsUrl: string,
): [boolean, () => void] {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(readCaptionsPreference());
  }, []);

  // Reapplied whenever the track's URL is renewed: a new src reloads the cues.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !captionsUrl) return;
    const apply = () => {
      for (const track of Array.from(el.textTracks)) {
        if (track.kind === "captions" || track.kind === "subtitles") {
          track.mode = on ? "showing" : "hidden";
        }
      }
    };
    apply();
    const tracks = el.textTracks;
    const onAdd = () => apply();
    const onChange = () => {
      const showing = Array.from(tracks).some(
        (track) => (track.kind === "captions" || track.kind === "subtitles") && track.mode === "showing",
      );
      setOn((current) => {
        if (current !== showing) storeCaptionsPreference(showing);
        return showing;
      });
    };
    tracks.addEventListener("addtrack", onAdd);
    tracks.addEventListener("change", onChange);
    return () => {
      tracks.removeEventListener("addtrack", onAdd);
      tracks.removeEventListener("change", onChange);
    };
  }, [videoRef, captionsUrl, on]);

  const toggle = useCallback(() => {
    setOn((current) => {
      storeCaptionsPreference(!current);
      return !current;
    });
  }, []);

  return [on, toggle];
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
  fullWatch,
  onSaved,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [rate, setRate] = useStoredPlaybackRate();
  const [captionsOn, toggleCaptions] = useCaptions(videoRef, captionsUrl);
  const [seekNotice, setSeekNotice] = useState(false);
  const fullWatchRequired = fullWatch?.required === true;

  const onSeekBlocked = useCallback(() => setSeekNotice(true), []);
  useEffect(() => {
    if (!seekNotice) return;
    const timer = window.setTimeout(() => setSeekNotice(false), 6000);
    return () => window.clearTimeout(timer);
  }, [seekNotice]);

  useMediaProgress({
    media: videoRef,
    lessonId,
    startAt,
    initialPercent,
    initialPlayedTo: fullWatch?.playedToSeconds ?? 0,
    restrictSeeking: fullWatchRequired,
    onSeekBlocked,
    onSaved,
  });
  useMediaKeys(videoRef, true);
  // The signed URL is renewed before it expires; this is what stops the swap
  // from restarting a lesson somebody is an hour into.
  useRenewableSource(videoRef, src);

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
          crossOrigin={captionsUrl && needsCorsForCaptions(captionsUrl, src) ? "anonymous" : undefined}
        >
          {captionsUrl && (
            <track kind="captions" src={captionsUrl} srcLang="en" label="English" />
          )}
        </video>
      </div>

      {fullWatchRequired && (
        <p aria-live="polite" className="text-xs text-orchid-faint">
          {seekNotice
            ? "You can skip back at any time, and ahead only as far as you have already watched."
            : "Watch this video through to complete the lesson — you can skip back, and ahead only as far as you have watched."}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <SpeedControl rate={rate} onChange={setRate} />
          {captionsUrl && (
            <button
              type="button"
              onClick={toggleCaptions}
              aria-pressed={captionsOn}
              className={cn(
                "inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border px-4",
                "text-sm font-medium transition-colors duration-300",
                captionsOn
                  ? "border-gold/50 bg-gold/[0.12] text-gold"
                  : "border-white/12 bg-white/[0.04] text-white hover:border-white/20",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/70",
              )}
            >
              <Captions aria-hidden className="size-4" />
              {captionsOn ? "Captions on" : "Captions off"}
            </button>
          )}
        </div>
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
