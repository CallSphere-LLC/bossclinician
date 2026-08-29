import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { adminApi, clearToken, getToken, setToken } from "@/lib/api";
import type { AdminUser } from "@/types";

interface AuthContextValue {
  user: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await adminApi.me();
        if (!cancelled) setUser(me);
      } catch {
        clearToken();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: loggedInUser } = await adminApi.login(email, password);
    setToken(token);
    setUser(loggedInUser);
  }, []);

  const logout = useCallback(() => {
    // Tell the server first, but do not wait for it and do not let it fail the
    // sign-out. Forgetting the token locally is the part the person in front of
    // the screen asked for; revoking the session is the part that stops a copy
    // of that token still working, and an offline laptop must not be able to
    // stay signed in just because the call didn't get through. It has to be
    // started before `clearToken`, because that is where the request picks up
    // the bearer token it is asking the server to revoke.
    void adminApi.logout().catch(() => undefined);
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
