import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { AuthUser } from "@workspace/api-client-react";

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
  refetch: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const CACHE_KEY = "__auth_user_v1";

function readCache(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function writeCache(user: AuthUser | null): void {
  try {
    if (user) {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(user));
    } else {
      sessionStorage.removeItem(CACHE_KEY);
    }
  } catch {
    // ignore – private browsing may block storage writes
  }
}

function getDevSid(): string | null {
  try {
    return sessionStorage.getItem("__dev_sid");
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const cached = readCache();
  // Always start loading=true so ProtectedRoute never evaluates permissions
  // against a potentially stale sessionStorage cache. The cached user is used
  // as the optimistic initial value (keeps the user visible during refetch)
  // but routing/permission gates must wait for the live /api/auth/user result.
  const [user, setUser] = useState<AuthUser | null>(cached);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [trigger, setTrigger] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    const headers: Record<string, string> = {};
    const devSid = getDevSid();
    if (devSid) headers["Authorization"] = `Bearer ${devSid}`;

    fetch("/api/auth/user", { credentials: "include", headers })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ user: AuthUser | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          const next = data.user ?? null;
          setUser(next);
          writeCache(next);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          writeCache(null);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const refetch = useCallback(() => {
    setTrigger((t) => t + 1);
  }, []);

  const login = useCallback(() => {
    window.location.href = "/";
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Protection": "1" },
      });
    } catch {
      // ignore network errors on logout
    }
    sessionStorage.removeItem("__dev_sid");
    writeCache(null);
    window.location.href = "/";
  }, []);

  const value: AuthState = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    refetch,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be called inside <AuthProvider>");
  }
  return ctx;
}
