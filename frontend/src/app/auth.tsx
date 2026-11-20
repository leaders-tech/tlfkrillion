/*
This file keeps the frontend auth state, login helpers, and session loading logic.
Edit this file when login, logout, refresh, or current-user browser behavior changes.
Copy the provider and hook pattern here when you add another small shared frontend context.
*/

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, postJson } from "../shared/api";
import type { User } from "../shared/types";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_REFRESH_INTERVAL_MS = 45 * 60 * 1000;

async function loadCurrentUser(): Promise<User | null> {
  try {
    const data = await postJson<{ user: User }>("/auth/me");
    return data.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      try {
        await postJson<{ user: User }>("/auth/refresh");
        const refreshed = await postJson<{ user: User }>("/auth/me");
        return refreshed.user;
      } catch (refreshError) {
        if (refreshError instanceof ApiError && refreshError.status === 401) {
          return null;
        }
        throw refreshError;
      }
    }
    throw error;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const didLoadSession = useRef(false);
  const refreshInFlight = useRef(false);
  const lastSessionRefresh = useRef(0);
  const sessionRefreshEpoch = useRef(0);

  useEffect(() => {
    if (didLoadSession.current) {
      return;
    }
    didLoadSession.current = true;
    loadCurrentUser()
      .then(setUser)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Could not load your session."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;

    const epoch = (sessionRefreshEpoch.current += 1);
    lastSessionRefresh.current = Date.now();
    const refreshSession = async () => {
      if (sessionRefreshEpoch.current !== epoch || refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        const refresh = () => postJson<{ user: User }>("/auth/refresh");
        if ("locks" in navigator) {
          await navigator.locks.request("krillion-auth-refresh", refresh);
        } else {
          await refresh();
        }
        if (sessionRefreshEpoch.current !== epoch) return;
        lastSessionRefresh.current = Date.now();
        setError("");
      } catch (refreshError) {
        if (sessionRefreshEpoch.current !== epoch) return;
        if (refreshError instanceof ApiError && refreshError.status === 401) {
          setUser(null);
          setError("Your session expired. Please sign in again.");
          return;
        }
        setError(refreshError instanceof Error ? refreshError.message : "Could not refresh your session.");
      } finally {
        refreshInFlight.current = false;
      }
    };
    const interval = window.setInterval(() => void refreshSession(), SESSION_REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && Date.now() - lastSessionRefresh.current >= SESSION_REFRESH_INTERVAL_MS) {
        void refreshSession();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      sessionRefreshEpoch.current += 1;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async login(username: string, password: string) {
        const data = await postJson<{ user: User }>("/auth/login", { username, password });
        setError("");
        setUser(data.user);
      },
      async logout() {
        await postJson<{ logged_out: boolean }>("/auth/logout");
        setUser(null);
      },
    }),
    [loading, user],
  );

  return (
    <AuthContext.Provider value={value}>
      {error ? (
        <p role="alert" className="bg-rose-50 px-4 py-3 text-rose-700">
          {error}
        </p>
      ) : null}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}

export { AuthContext };
