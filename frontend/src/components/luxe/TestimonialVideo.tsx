import { useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** Phones get the 540p file; so does anyone who has asked the browser to save data. */
const PHONE_QUERY = "(max-width: 767px)";

/** `navigator.connection` is not in lib.dom; only the one field read here is declared. */
type ConnectionNavigator = Navigator & { connection?: { saveData?: boolean } };

interface TestimonialVideoProps {
  /** Desktop source — H.264 + AAC, faststart. */
  src720: string;
  /** Phone / Save-Data source. */
  src540: string;
  poster: string;
  /** Names the player to a screen reader, e.g. "Mike's testimonial". */
  title: string;
  className?: string;
}

/**
 * A framed, click-to-play testimonial.
 *
 * Nothing is fetched but the poster until somebody presses play: the element is
 * rendered with no `src`, and the file is chosen inside the click — which is
 * also the only place `window` is read, so the server render needs no guard.
 * The source is assigned imperatively in the handler rather than through state
 * because Safari only honours `play()` with sound when it is called inside the
 * gesture itself, not from an effect a render later.
 *
 * Native `controls` once it is playing, for the reason given in
 * player/VideoPlayer.tsx — the platform's scrubber, fullscreen, AirPlay and
 * keyboard handling are already correct. They are held back until then so the
 * poster carries one obvious action instead of two competing play buttons.
 *
 * The frame is a `data-media-surface`: footage is dark in both themes, and the
 * hairline and scrim over it have to stay the dark-theme ones in light theme.
 * No `<track>`: there is no caption file for this recording yet. Add one here
 * when it exists rather than shipping a generated one nobody has checked.
 */
export function TestimonialVideo({ src720, src540, poster, title, className }: TestimonialVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  const start = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.currentSrc && !video.getAttribute("src")) {
      const lean =
        window.matchMedia(PHONE_QUERY).matches ||
        (navigator as ConnectionNavigator).connection?.saveData === true;
      video.src = lean ? src540 : src720;
    }
    setStarted(true);
    video.play().catch(() => {
      // Refused or failed: the native controls are on screen by now, so the
      // visitor still has a play button and the browser's own error state.
    });
  };

  return (
    <figure className={cn("mx-auto w-full max-w-4xl", className)}>
      <div
        data-media-surface
        className="relative isolate aspect-video overflow-hidden rounded-2xl border border-white/10 bg-[#06040b] shadow-glass-lg"
      >
        <video
          ref={videoRef}
          poster={poster}
          controls={started}
          controlsList="nodownload"
          playsInline
          preload="none"
          aria-label={title}
          onPlay={() => setStarted(true)}
          className="absolute inset-0 size-full object-cover"
        />

        {!started && (
          <button
            type="button"
            onClick={start}
            aria-label={`Play ${title}`}
            className="group absolute inset-0 z-[1] flex items-center justify-center focus-visible:outline-none"
          >
            {/* Enough shade for the foil disc to separate from a bright poster. */}
            <span
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-night-deep/70 via-night-deep/10 to-night-deep/25 transition-opacity duration-500 ease-luxe group-hover:opacity-80"
            />
            <span
              aria-hidden
              className={cn(
                "relative inline-flex size-16 items-center justify-center rounded-full bg-gold-foil text-night-deep shadow-glow-gold sm:size-20",
                "transition-transform duration-500 ease-luxe group-hover:scale-[1.06] group-active:scale-95",
                "group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-4 group-focus-visible:outline-gold",
              )}
            >
              {/* Nudged right: a triangle's visual centre is not its box's. */}
              <svg viewBox="0 0 24 24" className="ml-1 size-6 fill-current sm:size-7">
                <path d="M6 3.5v17l14-8.5z" />
              </svg>
            </span>
          </button>
        )}

        {/* The card's gradient hairline, drawn over the footage rather than
            under it — as a border on the frame it would be painted over. */}
        <div aria-hidden className="glass-edge pointer-events-none absolute inset-0 z-[2] rounded-[inherit]" />
      </div>
    </figure>
  );
}
