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
import { Navigate, useLocation } from "react-router-dom";
import {
  memberApi,
  setAccessToken,
  setSignedOutHandler,
  type MemberProfile,
} from "@/lib/memberApi";

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
  signUp: (input: {
    email: string;
    password: string;
    firstName: string;
    lastName?: string;
  }) => Promise<void>;
  signInWithToken: (token: string) => Promise<void>;
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

export function MemberAuthProvider({ children }: { children: ReactNode }) {
  const [member, setMemberState] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const applySession = useCallback((profile: MemberProfile, token: string) => {
    setAccessToken(token);
    setMemberState(profile);
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setMemberState(null);
  }, []);

  useEffect(() => {
    setSignedOutHandler(clearSession);
    return () => setSignedOutHandler(null);
  }, [clearSession]);

  useEffect(() => {
    let cancelled = false;
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
  }, [applySession]);

  // Refresh a couple of minutes before the 15-minute access token expires, so a
  // member reading a long lesson never gets bounced mid-scroll.
  useEffect(() => {
    if (!member) return;
    refreshTimer.current = setInterval(
      () => {
        void memberApi
          .refresh()
          .then(({ member: profile, accessToken }) => applySession(profile, accessToken))
          .catch(() => clearSession());
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
      const { member: profile, accessToken } = await memberApi.login(email, password);
      applySession(profile, accessToken);
    },
    [applySession],
  );

  const signUp = useCallback(
    async (input: { email: string; password: string; firstName: string; lastName?: string }) => {
      const { member: profile, accessToken } = await memberApi.register({
        ...input,
        timezone: detectTimezone(),
      });
      applySession(profile, accessToken);
    },
    [applySession],
  );

  const signInWithToken = useCallback(
    async (token: string) => {
      const { member: profile, accessToken } = await memberApi.consumeMagicLink(token);
      applySession(profile, accessToken);
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    try {
      await memberApi.logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

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
      signOut,
      setMember: setMemberState,
      refreshMember,
    }),
    [member, loading, signIn, signUp, signInWithToken, signOut, refreshMember],
  );

  return <MemberAuthContext.Provider value={value}>{children}</MemberAuthContext.Provider>;
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
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <>{children}</>;
}
