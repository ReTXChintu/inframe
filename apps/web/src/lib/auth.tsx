import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, refreshToken, setSignedOutHandler, setToken } from "./api";
import type { Me, User } from "./types";

export type Status = "loading" | "signed-in" | "signed-out";

interface AuthValue {
  status: Status;
  me: Me | undefined;
  user: User | undefined;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  /** Use a token obtained elsewhere (password reset, password change). */
  adoptToken: (token: string) => Promise<void>;
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

  const adoptToken = useCallback(
    async (token: string) => {
      setToken(token);
      setStatus("signed-in");
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
    [qc],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await api<{ accessToken: string }>("/api/auth/login", { body: { email, password } });
      qc.clear();
      await adoptToken(res.accessToken);
    },
    [adoptToken, qc],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      const res = await api<{ accessToken: string }>("/api/auth/signup", { body: { name, email, password } });
      qc.clear();
      await adoptToken(res.accessToken);
    },
    [adoptToken, qc],
  );

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    clear();
  }, [clear]);

  const value = useMemo<AuthValue>(
    () => ({ status, me: meQuery.data, user: meQuery.data?.user, signIn, signUp, adoptToken, signOut }),
    [status, meQuery.data, signIn, signUp, adoptToken, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
