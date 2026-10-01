import { useCallback, useEffect, useRef, useState } from "react";
import { isIdleSignOut, memberApi } from "@/lib/memberApi";
import {
  ACTIVITY_REPORT_INTERVAL_MS,
  ACTIVITY_WRITE_THROTTLE_MS,
  IDLE_CHECK_INTERVAL_MS,
  SIGNOUT_BROADCAST_KEY,
  getAbsoluteExpiresAt,
  getIdleTimeoutMs,
  getIdleWarningMs,
  isLastActivityKey,
  parseSignOutBroadcast,
  readLastActivity,
  writeLastActivity,
  type SignOutReason,
} from "@/lib/memberSessionPolicy";

/**
 * Signs a member out after a stretch of inactivity — QA sheet: "customer
 * dashboard is not signing off after a certain period of time".
 *
 * Mounted by MemberAuthProvider only while a real member is signed in (never
 * for an admin's read-only "view as member" window, which has no session to
 * end). What counts as the member being here:
 *
 *   - mouse, pointer, keyboard, touch, wheel and scroll in any open tab;
 *   - the tab coming back into view;
 *   - an audible video or audio element playing — a 45-minute lesson watched
 *     without touching the mouse is not inactivity;
 *   - a live call in the community room, in any state short of having left.
 *     The idle timer must never be what ends a call.
 *
 * Activity is shared between tabs through localStorage, so the clocks agree
 * and every tab warns, and signs out, together. While the warning is up, only
 * "Stay signed in" (or Escape) keeps the session — a mouse drifting across the
 * desk should not silently answer a security prompt.
 *
 * The server keeps its own copy of the clock (heartbeats to /api/auth/activity
 * and every refresh carry the idle time), so a cookie copied out of an
 * abandoned browser is refused even if this code never runs.
 */

/** Room states in which a call is in progress. */
const IN_CALL = new Set(["connecting", "waiting", "live", "reconnecting"]);

/** Cross-origin players whose focus is the only evidence of watching we can get. */
const VIDEO_EMBED = /youtube|youtu\.be|vimeo|wistia|loom|videodelivery|mux\.com|cloudflarestream/i;

function mediaPlaying(): boolean {
  if (typeof document === "undefined") return false;
  for (const el of Array.from(document.querySelectorAll("video, audio"))) {
    const media = el as HTMLMediaElement;
    // Muted media is ignored on purpose: the marketing pages loop muted
    // background films, and those must not keep anyone signed in.
    if (!media.paused && !media.ended && !media.muted && media.volume > 0) return true;
  }
  const active = document.activeElement;
  return (
    document.visibilityState === "visible" &&
    active instanceof HTMLIFrameElement &&
    VIDEO_EMBED.test(active.src)
  );
}

interface MemberIdleGuardProps {
  /** The idle or absolute clock ran out in this tab. */
  onExpire: (reason: SignOutReason) => void;
  /** Another tab signed out; this one only has to forget the session. */
  onRemoteSignOut: (reason: SignOutReason | "manual") => void;
}

export function MemberIdleGuard({ onExpire, onRemoteSignOut }: MemberIdleGuardProps) {
  const [warningOpen, setWarningOpen] = useState(false);
  const warningRef = useRef(false);
  const expiredRef = useRef(false);
  const inCallRef = useRef(false);
  const lastWriteRef = useRef(0);
  const lastSeenRef = useRef(0);
  // The refresh or sign-in that mounted this guard has just told the server.
  const lastReportRef = useRef(Date.now());

  const setWarning = useCallback((open: boolean) => {
    if (warningRef.current === open) return;
    warningRef.current = open;
    setWarningOpen(open);
  }, []);

  const expire = useCallback(
    (reason: SignOutReason) => {
      if (expiredRef.current) return;
      expiredRef.current = true;
      setWarning(false);
      onExpire(reason);
    },
    [onExpire, setWarning],
  );

  /** Tells the server, at most once a minute, that someone is still here. */
  const report = useCallback(
    (force = false) => {
      const now = Date.now();
      if (!force) {
        if (now - lastReportRef.current < ACTIVITY_REPORT_INTERVAL_MS) return;
        if (readLastActivity() <= lastReportRef.current) return; // nothing new to say
      }
      lastReportRef.current = now;
      memberApi.reportActivity().catch((error) => {
        // Only an explicit "this session went idle" ends anything here; a
        // network blip or a cookie rotated mid-flight is not a sign-out.
        if (isIdleSignOut(error)) expire("idle");
      });
    },
    [expire],
  );

  /**
   * Records activity. `fromInput` events are ignored while the warning is up
   * (see above); a call or a playing video is not, and closes the warning.
   */
  const bump = useCallback(
    (fromInput: boolean) => {
      if (expiredRef.current) return;
      const now = Date.now();
      // The first event after a laptop wakes arrives before any timer does. It
      // must not resurrect a session that ran out while the lid was shut.
      if (now - readLastActivity() >= getIdleTimeoutMs()) {
        expire("idle");
        return;
      }
      if (fromInput && warningRef.current) return;
      if (now - lastWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWriteRef.current = now;
      writeLastActivity(now);
    },
    [expire],
  );

  const check = useCallback(() => {
    if (expiredRef.current) return;
    const now = Date.now();
    const absolute = getAbsoluteExpiresAt();
    if (absolute !== null && now >= absolute) {
      expire("expired");
      return;
    }
    if (inCallRef.current || mediaPlaying()) bump(false);
    if (expiredRef.current) return;
    const remaining = readLastActivity() + getIdleTimeoutMs() - Date.now();
    if (remaining <= 0) {
      expire("idle");
      return;
    }
    setWarning(remaining <= getIdleWarningMs());
    report();
  }, [bump, expire, report, setWarning]);

  const staySignedIn = useCallback(() => {
    if (expiredRef.current) return;
    const now = Date.now();
    lastWriteRef.current = now;
    writeLastActivity(now);
    setWarning(false);
    report(true);
  }, [report, setWarning]);

  // Signing in, or loading the page with a live session, is activity. Once,
  // on mount — not again whenever a callback below changes identity.
  useEffect(() => {
    lastWriteRef.current = Date.now();
    writeLastActivity(lastWriteRef.current);
  }, []);

  useEffect(() => {
    const onInput = () => {
      const now = Date.now();
      // pointermove and scroll fire dozens of times a second; one look a
      // second is plenty for a clock measured in minutes.
      if (now - lastSeenRef.current < 1000) return;
      lastSeenRef.current = now;
      bump(true);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      bump(true);
      check();
    };
    const onStorage = (event: StorageEvent) => {
      if (isLastActivityKey(event.key)) {
        // Another tab saw the member (or they pressed "Stay signed in" there).
        check();
        return;
      }
      if (event.key === SIGNOUT_BROADCAST_KEY) {
        const reason = parseSignOutBroadcast(event.newValue);
        if (!reason || expiredRef.current) return;
        expiredRef.current = true;
        setWarning(false);
        onRemoteSignOut(reason);
      }
    };

    const options: AddEventListenerOptions = { passive: true, capture: true };
    const inputs = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const type of inputs) window.addEventListener(type, onInput, options);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);
    const timer = window.setInterval(check, IDLE_CHECK_INTERVAL_MS);

    // Loaded lazily so the marketing bundle does not carry the call engine for
    // a signed-in visitor reading the blog.
    let unsubscribe: (() => void) | null = null;
    let disposed = false;
    void import("@/lib/liveRoom/callManager")
      .then(({ subscribeRoom }) => {
        if (disposed) return;
        unsubscribe = subscribeRoom((snapshot) => {
          inCallRef.current = IN_CALL.has(snapshot.status);
        });
      })
      .catch(() => {
        // No call engine, no calls to protect.
      });

    return () => {
      disposed = true;
      for (const type of inputs) window.removeEventListener(type, onInput, options);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
      unsubscribe?.();
    };
  }, [bump, check, onRemoteSignOut, setWarning]);

  if (!warningOpen) return null;
  return <IdleWarningDialog onStay={staySignedIn} onSignOut={() => expire("idle")} />;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The two-minute warning.
 *
 * Rendered at the app root, outside `.theme-luxe` and outside any page, so it
 * names its own colours (as the Toaster and the account menu do) and sits above
 * the member shell's sticky header.
 */
function IdleWarningDialog({ onStay, onSignOut }: { onStay: () => void; onSignOut: () => void }) {
  const [remaining, setRemaining] = useState(
    () => readLastActivity() + getIdleTimeoutMs() - Date.now(),
  );
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    stayRef.current?.focus();
    const tick = window.setInterval(() => {
      setRemaining(readLastActivity() + getIdleTimeoutMs() - Date.now());
    }, 1000);
    return () => window.clearInterval(tick);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center px-4"
      style={{ background: "rgba(6, 4, 11, 0.72)", backdropFilter: "blur(4px)" }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="member-idle-title"
        aria-describedby="member-idle-body"
        onKeyDown={(event) => {
          if (event.key === "Escape") onStay();
        }}
        className="w-full max-w-sm rounded-2xl p-6 shadow-2xl sm:p-7"
        style={{
          background: "#100B1C",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "#F5F1FA",
          fontFamily: "Montserrat, Arial, sans-serif",
        }}
      >
        <h2 id="member-idle-title" className="text-lg font-semibold leading-snug">
          Are you still there?
        </h2>
        <p id="member-idle-body" className="mt-3 text-sm leading-relaxed" style={{ color: "#CFC6DD" }}>
          For your security, you will be signed out in{" "}
          <span className="font-bold tabular-nums" style={{ color: "#F5F1FA" }} aria-live="polite">
            {formatCountdown(remaining)}
          </span>{" "}
          because there has been no activity.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-11 rounded-full px-5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ border: "1px solid rgba(255,255,255,0.18)", color: "#F5F1FA", outlineColor: "#D4AF37" }}
          >
            Sign out now
          </button>
          <button
            ref={stayRef}
            type="button"
            onClick={onStay}
            className="min-h-11 rounded-full px-5 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ background: "#D4AF37", color: "#0B0A08", outlineColor: "#F5F1FA" }}
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
