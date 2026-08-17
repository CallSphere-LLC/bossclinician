import { useEffect, useRef, type RefObject } from "react";

/**
 * Keeps playback where it was when a signed media URL is renewed.
 *
 * A lesson's media is served from a link that expires (see `mediaExpiresAt` on
 * `UnlockedLesson`), so the player refetches the lesson before that moment and a
 * new `src` arrives on an element that is very likely mid-playback. Assigning
 * `src` makes the browser tear the media down and reload it from zero, and
 * nothing else puts it back: `useMediaProgress` seeks to the resume point once,
 * on the first `loadedmetadata` it sees, and deliberately does not do it again —
 * repeating that on every load would fight the member every time they scrubbed.
 *
 * The result, without this, is that somebody two hours into a long lesson gets
 * silently returned to the beginning, which is worse than the expiry it was
 * meant to prevent. So the position and whether it was playing are read from the
 * element itself, and restored once the replacement has loaded far enough to
 * accept a seek.
 *
 * Only a *renewal* is restored, never a lesson change. The first `src` is
 * recorded on mount and compared, and `LessonBody` is keyed on the lesson id, so
 * moving to the next lesson builds a fresh element with fresh refs and the
 * comparison never sees the old lesson's position.
 *
 * Position is tracked in refs off `timeupdate`, which fires several times a
 * second: holding it in state would re-render the transcript and the comment
 * thread underneath a playing video.
 */
export function useRenewableSource(media: RefObject<HTMLMediaElement | null>, src: string): void {
  const position = useRef(0);
  const playing = useRef(false);
  const previous = useRef(src);

  useEffect(() => {
    const el = media.current;
    if (!el) return;

    const note = () => {
      position.current = el.currentTime;
    };
    const onPlay = () => {
      playing.current = true;
    };
    const onPause = () => {
      playing.current = false;
    };

    el.addEventListener("timeupdate", note);
    el.addEventListener("seeked", note);
    el.addEventListener("play", onPlay);
    el.addEventListener("playing", onPlay);
    el.addEventListener("pause", onPause);

    return () => {
      el.removeEventListener("timeupdate", note);
      el.removeEventListener("seeked", note);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("playing", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [media]);

  useEffect(() => {
    const changed = previous.current !== src;
    previous.current = src;

    const el = media.current;
    // On mount `changed` is false, which is what leaves the initial load to
    // useMediaProgress and its resume-from-last-position rule.
    if (!el || !changed) return;

    const at = position.current;
    const wasPlaying = playing.current;
    if (at <= 0) return;

    const restore = () => {
      // A seek past the end of a media element that reports no duration yet is
      // ignored by some browsers and throws in others, so both are checked.
      if (Number.isFinite(el.duration) && el.duration > 0) {
        el.currentTime = Math.min(at, el.duration);
      }
      // Autoplay policy allows this: the member had already started playback on
      // this element, so the gesture requirement is satisfied. A rejection is
      // still possible and only means they press play again.
      if (wasPlaying) void el.play().catch(() => undefined);
    };

    if (el.readyState >= 1) {
      restore();
      return;
    }

    el.addEventListener("loadedmetadata", restore, { once: true });
    return () => el.removeEventListener("loadedmetadata", restore);
  }, [media, src]);
}
