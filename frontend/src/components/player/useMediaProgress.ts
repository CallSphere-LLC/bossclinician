import { useCallback, useEffect, useRef, type RefObject } from "react";
import { libraryApi, type ProgressResult } from "@/lib/libraryApi";

/**
 * Watch position, written back on a throttle.
 *
 * The position is held in refs rather than state on purpose: `timeupdate` fires
 * three or four times a second, and putting that in state would re-render the
 * whole lesson — transcript, comments and all — while a video plays.
 *
 * Nothing here decides completion. The server auto-completes at 90% and returns
 * the verdict, so `onSaved` is how the tick appears in the outline. A client
 * that decided for itself would disagree with the certificate.
 */

/** Roughly one write per ten seconds of playback, per the brief. */
const SAVE_INTERVAL_MS = 10_000;

/**
 * After three consecutive failures the pings stop for this lesson.
 *
 * Without a ceiling, a member whose access lapsed mid-video would post a
 * rejected write every ten seconds for as long as the tab stayed open.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Under this, "resuming" would rewind somebody who had barely begun. */
const RESUME_FLOOR_SECONDS = 5;

/** Within this of the end, resuming drops them straight onto the last frame. */
const RESUME_TAIL_SECONDS = 10;

interface MediaProgressOptions {
  media: RefObject<HTMLMediaElement | null>;
  lessonId: number;
  /** Where the member left off, from the lesson's own progress record. */
  startAt: number;
  initialPercent: number;
  onSaved?: (result: ProgressResult) => void;
}

export function useMediaProgress({
  media,
  lessonId,
  startAt,
  initialPercent,
  onSaved,
}: MediaProgressOptions): { flush: () => void } {
  const latest = useRef({ position: startAt, percent: initialPercent });
  const sent = useRef({ position: startAt, percent: initialPercent });
  const failures = useRef(0);

  // Held in a ref so a caller passing an inline callback does not tear down and
  // rebuild every media listener on each render.
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  useEffect(() => {
    latest.current = { position: startAt, percent: initialPercent };
    sent.current = { position: startAt, percent: initialPercent };
    failures.current = 0;
  }, [lessonId, startAt, initialPercent]);

  /**
   * `keepalive` is set by the writes that happen as the page goes away — the tab
   * being hidden, the component unmounting. It is the difference between losing
   * the last ten seconds of a lesson and not.
   */
  const save = useCallback(
    (keepalive: boolean) => {
      if (failures.current >= MAX_CONSECUTIVE_FAILURES) return;

      const { position, percent } = latest.current;
      const moved = Math.abs(position - sent.current.position) >= 1;
      const advanced = percent > sent.current.percent;
      if (!moved && !advanced) return;

      sent.current = { position, percent };
      void libraryApi
        .saveProgress(
          lessonId,
          { positionSeconds: position, watchedPercent: percent },
          keepalive ? { keepalive: true } : {},
        )
        .then((result) => {
          failures.current = 0;
          onSavedRef.current?.(result);
        })
        .catch(() => {
          failures.current += 1;
        });
    },
    [lessonId],
  );

  useEffect(() => {
    const el = media.current;
    if (!el) return;

    let resumed = false;
    let ticker: number | null = null;

    /**
     * `percent` only ever goes up. Scrubbing backwards is something people do on
     * purpose — to re-watch the bit that mattered — and it must not un-earn the
     * 90% that completes the lesson. The position is the opposite: it is where to
     * resume from, so jumping back is exactly what should be recorded.
     */
    const record = () => {
      const duration = el.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      const position = Math.max(0, Math.min(el.currentTime, duration));
      const percent = Math.min(100, Math.round((position / duration) * 100));
      latest.current = { position, percent: Math.max(latest.current.percent, percent) };
    };

    const resume = () => {
      if (resumed) return;
      resumed = true;
      const duration = el.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      if (startAt < RESUME_FLOOR_SECONDS) return;
      if (startAt > duration - RESUME_TAIL_SECONDS) return;
      el.currentTime = startAt;
    };

    const stopTicker = () => {
      if (ticker === null) return;
      window.clearInterval(ticker);
      ticker = null;
    };

    // The interval runs only while something is playing: a paused tab left open
    // overnight has nothing new to say every ten seconds.
    const onPlay = () => {
      if (ticker !== null) return;
      ticker = window.setInterval(() => {
        record();
        save(false);
      }, SAVE_INTERVAL_MS);
    };

    const onPause = () => {
      stopTicker();
      record();
      save(false);
    };

    const onEnded = () => {
      stopTicker();
      record();
      // Media that runs to its end is finished even if the last `timeupdate`
      // landed on 99: rounding must not be the reason a lesson stays untick.
      latest.current = { ...latest.current, percent: 100 };
      save(false);
    };

    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      record();
      save(true);
    };

    el.addEventListener("loadedmetadata", resume);
    el.addEventListener("timeupdate", record);
    el.addEventListener("seeked", record);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onHide);

    // A cached file can already have its metadata by the time this effect runs,
    // in which case `loadedmetadata` has fired and will not fire again.
    if (el.readyState >= 1) resume();

    return () => {
      stopTicker();
      el.removeEventListener("loadedmetadata", resume);
      el.removeEventListener("timeupdate", record);
      el.removeEventListener("seeked", record);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onHide);
      record();
      save(true);
    };
  }, [media, lessonId, startAt, save]);

  return { flush: useCallback(() => save(false), [save]) };
}
