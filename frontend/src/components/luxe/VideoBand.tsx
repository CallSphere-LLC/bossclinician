import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { Container } from "@/components/ui/Container";
import { cn } from "@/lib/cn";

/** Phones get the 540p file: it is half the bytes and indistinguishable under the veil. */
const PHONE_QUERY = "(max-width: 767px)";
/** Wide enough that a 720p frame is being stretched; only then is 1080p worth its bytes. */
const WIDE_QUERY = "(min-width: 1280px)";

/** `navigator.connection` is not in lib.dom; only the one field read here is declared. */
type ConnectionNavigator = Navigator & { connection?: { saveData?: boolean } };

interface VideoBandProps {
  /** Desktop source — H.264, no audio track, faststart. */
  /** Optional sharper file for wide screens. */
  src1080?: string;
  src720: string;
  /** Phone source, chosen once at mount. */
  src540: string;
  /** The video's own first frame, so the poster-to-footage handoff does not jump. */
  poster: string;
  className?: string;
  "aria-label"?: string;
  children: ReactNode;
}

/**
 * A full-bleed band of silent, looping footage with one centred line over it.
 *
 * The footage is decoration and is treated as such: hidden from assistive
 * technology, out of the tab order, and not fetched at all until the band is
 * about to scroll into view. The server render and the first client render are
 * the poster alone — no `src` — so nothing here reads `window` while rendering
 * and a visitor who never scrolls this far never downloads a video.
 *
 * Reduced motion is read with `useReducedMotion()` and deliberately NOT with
 * `useEntranceMotion()`. That hook also answers `true` for every component
 * hydrated from server-rendered markup, for its whole life, which is right for
 * an entrance fade and would mean this band never plays on a page that is
 * server-rendered — which /club is.
 *
 * `data-media-surface` keeps the band dark in the light theme (site-theme.css):
 * it restores the night palette inside the section, so the token-based veil
 * below stays dark and white type over the footage stays white.
 */
export function VideoBand({
  src1080,
  src720,
  src540,
  poster,
  className,
  children,
  ...rest
}: VideoBandProps) {
  const prefersReduced = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Undefined until the band nears the viewport; stays undefined for a visitor
  // who asked for less motion or less data, who keeps the poster.
  const [src, setSrc] = useState<string>();
  const [inView, setInView] = useState(false);
  // The visitor's own choice. Scrolling away and back must not overrule it.
  const [userPaused, setUserPaused] = useState(false);
  // What the element is actually doing — autoplay can be refused (iOS Low Power
  // Mode), and the button has to describe the truth rather than the intent.
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || prefersReduced) {
      setInView(false);
      return;
    }
    if ((navigator as ConnectionNavigator).connection?.saveData) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setInView(entry.isIntersecting);
        if (entry.isIntersecting) {
          setSrc((current) => {
            if (current) return current;
            if (window.matchMedia(PHONE_QUERY).matches) return src540;
            return src1080 && window.matchMedia(WIDE_QUERY).matches ? src1080 : src720;
          });
        }
      },
      // Start fetching a little before the band is on screen, so the first
      // frames are there by the time it is.
      { rootMargin: "200px 0px" },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [prefersReduced, src540, src720, src1080]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    if (inView && !userPaused && !prefersReduced) {
      // React does not reliably serialise `muted` to the attribute, and an
      // element the browser believes has sound is refused autoplay.
      video.muted = true;
      // A refusal is not an error worth surfacing: the poster stays, and the
      // toggle below still starts it from a real gesture.
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [src, inView, userPaused, prefersReduced]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setUserPaused(false);
      // Called here as well as in the effect: when autoplay was refused the
      // state does not change, and only a call inside the gesture is allowed.
      video.muted = true;
      video.play().catch(() => {});
    } else {
      setUserPaused(true);
      video.pause();
    }
  };

  return (
    <section
      ref={sectionRef}
      data-media-surface
      className={cn(
        "relative isolate flex items-center overflow-hidden bg-night-deep text-white",
        // Generous, but a fraction of the source page's 240px: section padding
        // is symmetric, so every pixel here is paid twice against its neighbours.
        "py-16 sm:py-20 lg:py-28 short:py-14",
        className,
      )}
      {...rest}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        preload="none"
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden
        tabIndex={-1}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="pointer-events-none absolute inset-0 -z-10 size-full object-cover"
      />

      {/* The veil. Night and plum rather than the source page's navy, at about
          the same density; the vertical gradient closes to the page floor at
          both edges so the band hands off to its neighbours without a hard line. */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-night/60" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(123,94,167,0.24),transparent_70%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-night-deep via-transparent to-night-deep opacity-90"
      />
      <div aria-hidden className="rule-faint absolute inset-x-0 top-0 w-full" />
      <div aria-hidden className="rule-faint absolute inset-x-0 bottom-0 w-full" />

      <Container className="relative">{children}</Container>

      {/* WCAG 2.2.2: motion that starts by itself and runs past five seconds
          needs a way to stop it. Absent when there is nothing to stop. */}
      {src && (
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause background video" : "Play background video"}
          className={cn(
            "absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 sm:bottom-5 sm:right-6",
            "border-white/12 bg-night-deep/55 text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-white/80 backdrop-blur",
            "transition-colors hover:bg-night-deep/80 hover:text-white",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          )}
        >
          <svg aria-hidden viewBox="0 0 12 12" className="size-2.5 fill-current">
            {playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" /> : <path d="M2.5 1v10l8-5z" />}
          </svg>
          {playing ? "Pause" : "Play"}
        </button>
      )}
    </section>
  );
}
