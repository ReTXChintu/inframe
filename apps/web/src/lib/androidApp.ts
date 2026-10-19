import { useQuery } from "@tanstack/react-query";

export interface AndroidApp {
  version: string;
  build: number;
  size: number;
  url: string;
  publishedAt: string;
}

/**
 * The Android release workflow publishes `/app-version.json` next to
 * `/inframe.apk`. Before the first release it doesn't exist, and the
 * download buttons stay hidden.
 */
export function useAndroidApp() {
  return useQuery({
    queryKey: ["android-app"],
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async (): Promise<AndroidApp | null> => {
      const res = await fetch("/app-version.json", { cache: "no-store" });
      if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
      const body = await res.json().catch(() => null);
      return body && typeof body.url === "string" ? (body as AndroidApp) : null;
    },
  });
}
