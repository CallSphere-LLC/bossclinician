import { useEffect, type RefObject } from "react";

/**
 * Player keyboard shortcuts, bound at the window.
 *
 * Bound at the window rather than on the media element because the shortcut is
 * only useful when focus is somewhere else — nobody needs a play key while the
 * play button is focused, and the browser already answers that case itself.
 *
 * Which makes the guards the whole substance of this file. Space is the page's
 * scroll key and the activation key for every button and link on it; hijacking
 * it while someone is typing a note or tabbing through the outline would be a
 * worse bug than not having the shortcut at all.
 */

const SEEK_SECONDS = 5;
const LONG_SEEK_SECONDS = 10;

/** Anywhere a keystroke means a character. */
function isTextEntry(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  return node.matches('input, textarea, select, [role="textbox"], [role="combobox"]');
}

/** Anywhere Space or Enter already means "press this". */
function isActivatable(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  return node.matches('button, summary, a[href], [role="button"], [role="tab"], [role="menuitem"]');
}

export function useMediaKeys(media: RefObject<HTMLMediaElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (event: KeyboardEvent) => {
      const el = media.current;
      if (!el || event.defaultPrevented) return;
      // Modified keys belong to the browser: Cmd-L is the address bar, not seek.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (isTextEntry(target)) return;
      // The native controls answer these keys themselves while they hold focus,
      // and handling them here as well would toggle play twice per press.
      if (target instanceof Node && el.contains(target)) return;

      const seek = (delta: number) => {
        const duration = Number.isFinite(el.duration) ? el.duration : Infinity;
        el.currentTime = Math.max(0, Math.min(el.currentTime + delta, duration));
      };

      switch (event.key) {
        case " ":
        case "k":
        case "K":
          if (event.key === " " && isActivatable(target)) return;
          event.preventDefault();
          if (el.paused) void el.play().catch(() => undefined);
          else el.pause();
          return;

        case "ArrowLeft":
          event.preventDefault();
          seek(-(event.shiftKey ? LONG_SEEK_SECONDS : SEEK_SECONDS));
          return;

        case "ArrowRight":
          event.preventDefault();
          seek(event.shiftKey ? LONG_SEEK_SECONDS : SEEK_SECONDS);
          return;

        case "j":
        case "J":
          event.preventDefault();
          seek(-LONG_SEEK_SECONDS);
          return;

        case "l":
        case "L":
          event.preventDefault();
          seek(LONG_SEEK_SECONDS);
          return;

        case "m":
        case "M":
          event.preventDefault();
          el.muted = !el.muted;
          return;

        case "f":
        case "F": {
          if (!(el instanceof HTMLVideoElement)) return;
          event.preventDefault();
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          else void el.requestFullscreen().catch(() => undefined);
          return;
        }

        default:
          return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [media, enabled]);
}
