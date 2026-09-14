import { clearLegacyAdminToken } from "@/lib/adminTransport";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ApiError, adminApi } from "@/lib/api";
import { uploadManager } from "@/lib/uploads/manager";
import type { AdminUser } from "@/types";

interface AuthContextValue {
  user: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string, code?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      clearLegacyAdminToken();
      // Only the server refusing this session signs the admin out. A
      // 5xx, a 429 or a dropped connection says nothing about the token, and
      // clearing it on one of those threw people out mid-session; retry those
      // briefly instead, and keep the session if they persist so a reload works.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const me = await adminApi.me();
          if (!cancelled) setUser(me);
          break;
        } catch (err) {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            clearLegacyAdminToken();
            break;
          }
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
        }
      }
      if (!cancelled) setLoading(false);
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string, code?: string) => {
    const { user: loggedInUser } = await adminApi.login(email, password, code);
    clearLegacyAdminToken();
    setUser(loggedInUser);
    // An upload that stopped because the session expired is holding a file and
    // a place in it. Now there is a token again, it can carry on from the byte
    // it reached rather than waiting to be noticed.
    uploadManager.resumeAfterSignIn();
  }, []);

  const logout = useCallback(async () => {
    // HttpOnly cookies cannot be discarded by JavaScript. Do not pretend a
    // failed request signed this device out; wait for server revocation.
    await adminApi.logout();
    clearLegacyAdminToken();
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
