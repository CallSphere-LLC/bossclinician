import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router";
import {
  isRegistrationPending,
  memberApi,
  MemberApiError,
  setAccessToken,
  setSignedOutHandler,
  type MemberProfile,
} from "@/lib/memberApi";
import {
  applySessionPolicy,
  broadcastSignOut,
  clearSignOutReason,
  noteSignOutReason,
  peekSignOutReason,
  resetSessionPolicy,
  type SessionPolicyPayload,
  type SignOutReason,
} from "@/lib/memberSessionPolicy";
import { MemberIdleGuard } from "@/hooks/useMemberIdle";

/**
 * Member auth context — the customer-side counterpart to hooks/useAuth.tsx.
 *
 * On mount it tries one silent refresh against the HttpOnly cookie. That is the
 * only way a reload can know who you are, since the access token is held in
 * memory and dies with the page.
 */

interface MemberAuthValue {
  member: MemberProfile | null;
  /** True until the initial refresh settles. Guards render a spinner, not a redirect. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Resolves `true` when the account was created and the member is now signed
   * in, and `false` when the address already existed and a link was emailed
   * instead. Both are successful outcomes — the caller renders a different
   * screen, not an error.
   */
  signUp: (input: {
    email: string;
    password: string;
    firstName: string;
    lastName?: string;
  }) => Promise<boolean>;
  signInWithToken: (token: string) => Promise<void>;
  /**
   * Trades a one-time host link from the admin for a member session as the
   * community's host. Replaces whoever was signed in here before.
   */
  signInAsHost: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Replaces the cached profile after a save, without a round trip. */
  setMember: (member: MemberProfile) => void;
  refreshMember: () => Promise<void>;
}

const MemberAuthContext = createContext<MemberAuthValue | null>(null);

/** The browser's own guess, so a new account gets sensible times without asking. */
function detectTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the server left a "you have a session" marker on the last sign-in.
 *
 * The refresh token itself is HttpOnly and scoped to /api/auth, so script
 * cannot see it. Without this hint every anonymous visitor to the marketing
 * site would spend a round trip discovering they are not signed in.
 */
export function hasMemberSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c.startsWith("bc_member_active="));
}

export function MemberAuthProvider({ children }: { children: ReactNode }) {
  const [member, setMemberState] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewToken] = useState(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem("bc_member_impersonation");
  });
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const applySession = useCallback(
    (profile: MemberProfile, token: string, policy?: SessionPolicyPayload) => {
      applySessionPolicy(policy);
      setAccessToken(token);
      setMemberState(profile);
    },
    [],
  );

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setMemberState(null);
    resetSessionPolicy();
  }, []);

  useEffect(() => {
    setSignedOutHandler(clearSession);
    return () => setSignedOutHandler(null);
  }, [clearSession]);

  useEffect(() => {
    let cancelled = false;

    if (previewToken) {
      sessionStorage.removeItem("bc_member_impersonation");
      setAccessToken(previewToken);
      void memberApi.me().then((profile) => {
        if (!cancelled) applySession(profile, previewToken);
      }).catch(() => { if (!cancelled) clearSession(); }).finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    if (!hasMemberSessionHint()) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const { member: profile, accessToken } = await memberApi.refresh();
        if (!cancelled) applySession(profile, accessToken);
      } catch {
        // No cookie, or it has expired: simply signed out. Not an error state.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession, clearSession, previewToken]);

  // Enforce session expiry even while a member leaves a lesson open. The
  // shared client refreshes expired access tokens and clears an ended session.
  useEffect(() => {
    if (!member || member.impersonatedBy) return;
    const verify = () => { void memberApi.me().catch(() => {}); };
    const timer = window.setInterval(verify, 60_000);
    window.addEventListener("focus", verify);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", verify); };
  }, [member?.id, member?.impersonatedBy]);

  // Refresh a couple of minutes before the 15-minute access token expires, so a
  // member reading a long lesson never gets bounced mid-scroll.
  useEffect(() => {
    if (!member || member.impersonatedBy) return;
    refreshTimer.current = setInterval(
      () => {
        void memberApi
          .refresh()
          .then(({ member: profile, accessToken }) => applySession(profile, accessToken))
          .catch((error) => {
            if (error instanceof MemberApiError && (error.status === 401 || error.status === 403)) clearSession();
          });
      },
      13 * 60 * 1000,
    );
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    };
  }, [member, applySession, clearSession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { member: profile, accessToken, session } = await memberApi.login(email, password);
      clearSignOutReason();
      applySession(profile, accessToken, session);
    },
    [applySession],
  );

  const signUp = useCallback(
    async (input: { email: string; password: string; firstName: string; lastName?: string }) => {
      const result = await memberApi.register({ ...input, timezone: detectTimezone() });
      if (isRegistrationPending(result)) return false;
      applySession(result.member, result.accessToken, result.session);
      return true;
    },
    [applySession],
  );

  const signInWithToken = useCallback(
    async (token: string) => {
      const { member: profile, accessToken, session } = await memberApi.consumeMagicLink(token);
      clearSignOutReason();
      applySession(profile, accessToken, session);
    },
    [applySession],
  );

  const signInAsHost = useCallback(
    async (token: string) => {
      const { member: profile, accessToken, session } = await memberApi.consumeHostLink(token);
      clearSignOutReason();
      applySession(profile, accessToken, session);
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    try {
      await memberApi.logout();
    } finally {
      clearSession();
      // Every other open tab forgets the session too, rather than carrying on
      // until its next refresh discovers the cookie is gone.
      broadcastSignOut("manual");
    }
  }, [clearSession]);

  /**
   * The idle (or absolute) clock ran out in this tab. The reason is stashed
   * for RequireMember, which turns the cleared session into a redirect to
   * /login?reason=… — so a member page lands on the sign-in form with the
   * explanation, and a signed-in reader of a public page is simply signed out.
   */
  const expireSession = useCallback(
    async (reason: SignOutReason) => {
      noteSignOutReason(reason);
      broadcastSignOut(reason);
      try {
        // Only reachable mid-call through the absolute cap (a call counts as
        // activity), but a call must never outlive the session it belongs to.
        const room = await import("@/lib/liveRoom/callManager");
        const { status } = room.getRoomSnapshot();
        if (["connecting", "waiting", "live", "reconnecting"].includes(status)) {
          await room.leaveRoom();
        }
      } catch {
        // No call engine loaded, or leaving failed: signing out still happens.
      }
      try {
        await memberApi.logout();
      } catch {
        // The server ends the session itself on the next refresh.
      } finally {
        clearSession();
      }
    },
    [clearSession],
  );

  const remoteSignOut = useCallback(
    (reason: SignOutReason | "manual") => {
      if (reason !== "manual") noteSignOutReason(reason);
      // Same rule as expireSession: no call outlives its session, even when the
      // news came from another tab.
      void import("@/lib/liveRoom/callManager")
        .then((room) => {
          const { status } = room.getRoomSnapshot();
          if (["connecting", "waiting", "live", "reconnecting"].includes(status)) {
            return room.leaveRoom();
          }
        })
        .catch(() => {});
      clearSession();
    },
    [clearSession],
  );

  const onIdleExpire = useCallback(
    (reason: SignOutReason) => {
      void expireSession(reason);
    },
    [expireSession],
  );

  const refreshMember = useCallback(async () => {
    const profile = await memberApi.me();
    setMemberState(profile);
  }, []);

  const value = useMemo<MemberAuthValue>(
    () => ({
      member,
      loading,
      signIn,
      signUp,
      signInWithToken,
      signInAsHost,
      signOut,
      setMember: setMemberState,
      refreshMember,
    }),
    [member, loading, signIn, signUp, signInWithToken, signInAsHost, signOut, refreshMember],
  );

  return (
    <MemberAuthContext.Provider value={value}>
      {children}
      {/* Not for "view as member": an admin's preview has no session to end. */}
      {member && !member.impersonatedBy && (
        <MemberIdleGuard
          key={member.id}
          onExpire={onIdleExpire}
          onRemoteSignOut={remoteSignOut}
        />
      )}
    </MemberAuthContext.Provider>
  );
}

export function useMember(): MemberAuthValue {
  const ctx = useContext(MemberAuthContext);
  if (!ctx) throw new Error("useMember must be used within a MemberAuthProvider");
  return ctx;
}

/**
 * Route guard. Sends a signed-out visitor to /login carrying where they were
 * headed, so signing in drops them back on the page they asked for rather than
 * a generic dashboard.
 */
export function RequireMember({ children }: { children: ReactNode }) {
  const { member, loading } = useMember();
  const location = useLocation();
  const signedOut = !loading && !member;
  // Read during render, so the redirect below can carry it; cleared once that
  // redirect has been committed, so it is said once and not on every visit.
  const reason = signedOut ? peekSignOutReason() : null;
  useEffect(() => {
    if (signedOut) clearSignOutReason();
  }, [signedOut]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span
          className="size-9 animate-spin rounded-full border-2 border-lilac border-t-plum"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (!member) {
    const next = encodeURIComponent(location.pathname + location.search);
    const why = reason ? `&reason=${reason}` : "";
    return <Navigate to={`/login?next=${next}${why}`} replace />;
  }

  return <>{children}</>;
}
