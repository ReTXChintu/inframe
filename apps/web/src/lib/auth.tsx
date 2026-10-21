import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, refreshToken, setSignedOutHandler, setToken } from "./api";
import type { Me, User } from "./types";

export type Status = "loading" | "signed-in" | "signed-out";

interface AuthValue {
  status: Status;
  me: Me | undefined;
  user: User | undefined;
  /**
   * Ends the InFrame session, then sends the browser to the identity server
   * to end that session too (it comes back to /login). Signing in happens
   * entirely on the server (/api/auth/oidc/start → callback), which leaves a
   * refresh cookie this provider picks up on load.
   */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/api/me"),
    enabled: status === "signed-in",
    staleTime: 30_000,
  });

  const clear = useCallback(() => {
    setToken(null);
    qc.clear();
    setStatus("signed-out");
  }, [qc]);

  useEffect(() => {
    setSignedOutHandler(clear);
    refreshToken().then((token) => setStatus(token ? "signed-in" : "signed-out"));
  }, [clear]);

  const signOut = useCallback(async () => {
    const res = await api<{ endSessionUrl?: string | null }>("/api/auth/logout", { method: "POST" }).catch(() => null);
    clear();
    if (res?.endSessionUrl) window.location.assign(res.endSessionUrl);
  }, [clear]);

  const value = useMemo<AuthValue>(
    () => ({ status, me: meQuery.data, user: meQuery.data?.user, signOut }),
    [status, meQuery.data, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
