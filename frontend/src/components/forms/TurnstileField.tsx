import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

/**
 * Cloudflare Turnstile, rendered explicitly.
 *
 * The site renders on the server, so nothing here touches `window` or
 * `document` until an effect runs in the browser. The script is shared: one
 * tag per page however many widgets mount, and a widget that unmounts removes
 * itself so a remount (or a second form) never inherits a spent token.
 *
 * The site key comes from Settings (form_settings.turnstileSiteKey via the
 * public settings endpoint) and is passed in by the caller — it is never
 * written into the bundle.
 */

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
  theme: "auto" | "light" | "dark";
  size?: "normal" | "compact" | "flexible";
}

interface TurnstileApi {
  render: (el: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loader: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loader) return loader;

  loader = new Promise<TurnstileApi>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const fail = () => {
      loader = null;
      script?.remove();
      reject(new Error("Turnstile failed to load"));
    };
    if (!script) {
      script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener(
      "load",
      () => (window.turnstile ? resolve(window.turnstile) : fail()),
      { once: true },
    );
    script.addEventListener("error", fail, { once: true });
  });
  return loader;
}

export interface TurnstileHandle {
  /** Tokens are single-use: call after every submit attempt. */
  reset: () => void;
}

interface TurnstileFieldProps {
  siteKey: string;
  /** A fresh token, or null once it expires, errors or is reset. */
  onToken: (token: string | null) => void;
  ref?: Ref<TurnstileHandle>;
}

/** The normal widget is 300px wide; below that it would overflow the card. */
const NORMAL_WIDTH = 300;

export function TurnstileField({ siteKey, onToken, ref }: TurnstileFieldProps) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // The latest callback, so a parent re-render never re-renders the widget.
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [loadFailed, setLoadFailed] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        onTokenRef.current(null);
        if (widgetId.current && window.turnstile) {
          try {
            window.turnstile.reset(widgetId.current);
          } catch {
            // A widget torn down mid-reset has nothing to reset.
          }
        }
      },
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);

    loadTurnstile()
      .then((ts) => {
        const el = container.current;
        if (cancelled || !el) return;
        const id = ts.render(el, {
          sitekey: siteKey,
          theme: "auto",
          size: el.clientWidth > 0 && el.clientWidth < NORMAL_WIDTH ? "compact" : "normal",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
        widgetId.current = id ?? null;
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
      const id = widgetId.current;
      widgetId.current = null;
      onTokenRef.current(null);
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {
          // Already gone.
        }
      }
    };
  }, [siteKey]);

  return (
    <div className="flex flex-col items-center gap-2 sm:items-start">
      <div ref={container} className="flex min-h-[65px] w-full max-w-full justify-center overflow-hidden sm:justify-start" />
      {loadFailed && (
        <p className="text-center text-sm leading-relaxed text-white/70 sm:text-left">
          The security check couldn't load. Please refresh the page, or email{" "}
          <a className="underline underline-offset-2" href="mailto:bossclinician@gmail.com">
            bossclinician@gmail.com
          </a>{" "}
          directly.
        </p>
      )}
    </div>
  );
}
