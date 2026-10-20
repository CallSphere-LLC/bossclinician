import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { ProgressResult } from "@/lib/libraryApi";
import { usePlayerSource } from "@/components/player/playerSource";

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

/**
 * The largest step between two `timeupdate`s that still counts as playing on,
 * per 1x of playback rate. `timeupdate` fires every quarter second or so; a
 * background tab can stretch that, and anything longer than this is a seek.
 */
const CONTIGUOUS_STEP_SECONDS = 2;

/** How far past the furthest point played a seek may land on a full-watch lesson. */
const SEEK_TOLERANCE_SECONDS = 2;

/**
 * The furthest point played through, advanced by one `timeupdate` sample.
 *
 * It only moves when the media got from `previous` to `current` by playing —
 * forward, by a small step, starting from somewhere already played. A seek
 * (`previous` null, or a big jump) never moves it, so jumping to the end of a
 * lesson is not having watched to the end. Exported for tests.
 */
export function advanceContiguous(input: {
  playedTo: number;
  previous: number | null;
  current: number;
  playbackRate: number;
}): number {
  const { playedTo, previous, current } = input;
  if (previous === null) return playedTo;
  const step = current - previous;
  const maxStep = CONTIGUOUS_STEP_SECONDS * Math.max(1, input.playbackRate);
  if (step < 0 || step > maxStep) return playedTo;
  if (previous > playedTo + SEEK_TOLERANCE_SECONDS) return playedTo;
  return Math.max(playedTo, current);
}

interface MediaProgressOptions {
  media: RefObject<HTMLMediaElement | null>;
  lessonId: number;
  /** Where the member left off, from the lesson's own progress record. */
  startAt: number;
  initialPercent: number;
  /** Furthest point already played through, from the lesson's progress record. */
  initialPlayedTo?: number;
  /**
   * "Require watching the full video": a seek past the furthest point played is
   * pulled back to it. Keyboard skips and the scrub bar both seek, so both are
   * covered; captions and everything else are untouched.
   */
  restrictSeeking?: boolean;
  /** Told when a seek was pulled back, so the player can say why. */
  onSeekBlocked?: () => void;
  onSaved?: (result: ProgressResult) => void;
}

export function useMediaProgress({
  media,
  lessonId,
  startAt,
  initialPercent,
  initialPlayedTo = 0,
  restrictSeeking = false,
  onSeekBlocked,
  onSaved,
}: MediaProgressOptions): { flush: () => void } {
  const latest = useRef({ position: startAt, percent: initialPercent, playedTo: initialPlayedTo });
  const sent = useRef({ position: startAt, percent: initialPercent, playedTo: initialPlayedTo });
  const failures = useRef(0);
  const onSeekBlockedRef = useRef(onSeekBlocked);
  useEffect(() => {
    onSeekBlockedRef.current = onSeekBlocked;
  }, [onSeekBlocked]);
  // An admin's "Preview as student" plays the lesson and records nothing.
  const { api, preview } = usePlayerSource();
  const readOnly = preview !== null;

  // Held in a ref so a caller passing an inline callback does not tear down and
  // rebuild every media listener on each render.
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  useEffect(() => {
    latest.current = { position: startAt, percent: initialPercent, playedTo: initialPlayedTo };
    sent.current = { position: startAt, percent: initialPercent, playedTo: initialPlayedTo };
    failures.current = 0;
  }, [lessonId, startAt, initialPercent, initialPlayedTo]);

  /**
   * `keepalive` is set by the writes that happen as the page goes away — the tab
   * being hidden, the component unmounting. It is the difference between losing
   * the last ten seconds of a lesson and not.
   */
  const save = useCallback(
    (keepalive: boolean) => {
      if (readOnly) return;
      if (failures.current >= MAX_CONSECUTIVE_FAILURES) return;

      const { position, percent, playedTo } = latest.current;
      const moved = Math.abs(position - sent.current.position) >= 1;
      const advanced = percent > sent.current.percent || playedTo >= sent.current.playedTo + 1;
      if (!moved && !advanced) return;

      sent.current = { position, percent, playedTo };
      void api
        .saveProgress(
          lessonId,
          { positionSeconds: position, watchedPercent: percent, playedToSeconds: playedTo },
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
    [api, lessonId, readOnly],
  );

  useEffect(() => {
    const el = media.current;
    if (!el) return;

    let resumed = false;
    let ticker: number | null = null;
    // The last `timeupdate` position, or null straight after a seek.
    let previousTime: number | null = el.currentTime;

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
      const playedTo = el.seeking
        ? latest.current.playedTo
        : advanceContiguous({
            playedTo: latest.current.playedTo,
            previous: previousTime,
            current: position,
            playbackRate: el.playbackRate,
          });
      if (!el.seeking) previousTime = position;
      latest.current = {
        position,
        percent: Math.max(latest.current.percent, percent),
        playedTo,
      };
    };

    const onSeeking = () => {
      previousTime = null;
      if (!restrictSeeking) return;
      const limit = latest.current.playedTo + SEEK_TOLERANCE_SECONDS;
      if (el.currentTime > limit) {
        el.currentTime = latest.current.playedTo;
        onSeekBlockedRef.current?.();
      }
    };

    // Landing from a seek records the new position without advancing the
    // furthest point; playback from here moves it only by playing on.
    const onSeeked = () => {
      previousTime = null;
      record();
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
      // (The furthest point played is left to `record`: ending is only having
      // watched to the end if the media got there by playing.)
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
    el.addEventListener("seeking", onSeeking);
    el.addEventListener("seeked", onSeeked);
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
      el.removeEventListener("seeking", onSeeking);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onHide);
      record();
      save(true);
    };
  }, [media, lessonId, startAt, save, restrictSeeking]);

  return { flush: useCallback(() => save(false), [save]) };
}
