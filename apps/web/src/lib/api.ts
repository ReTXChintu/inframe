/*
 * The access token lives in memory only. The refresh token is an httpOnly
 * cookie scoped to /api/auth, so a page reload calls /api/auth/refresh to get
 * a fresh access token, and any 401 triggers one refresh-and-retry.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onSignedOut: () => void = () => {};

export const getToken = () => accessToken;
export const setToken = (token: string | null) => {
  accessToken = token;
};
export const setSignedOutHandler = (fn: () => void) => {
  onSignedOut = fn;
};

async function toError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  return new ApiError(
    res.status,
    body?.code ?? "error",
    body?.message ?? (res.status >= 500 ? "Something went wrong. Try again." : res.statusText),
    body?.details?.fields ?? {},
  );
}

/** Get a new access token from the refresh cookie; null if the session is gone. */
export function refreshToken(): Promise<string | null> {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) return null;
      const body = await res.json();
      accessToken = body.accessToken;
      return accessToken;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

interface Options {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    return fetch(path, {
      method: opts.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: opts.signal,
      credentials: "same-origin",
    });
  };

  let res = await send();
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    const token = await refreshToken();
    if (!token) {
      onSignedOut();
      throw await toError(res);
    }
    res = await send();
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** XHR upload so the caller gets byte progress (fetch can't report upload progress). */
export function uploadWithProgress<T>(
  path: string,
  form: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  const attempt = () =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", path);
      if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let body: any = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* non-JSON */
        }
        resolve({ status: xhr.status, body });
      };
      xhr.onerror = () => reject(new ApiError(0, "network", "Network error — check your connection."));
      xhr.onabort = () => reject(new ApiError(0, "aborted", "Cancelled."));
      signal?.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.send(form);
    });

  return (async () => {
    let res = await attempt();
    if (res.status === 401 && (await refreshToken())) res = await attempt();
    if (res.status < 200 || res.status >= 300) {
      throw new ApiError(res.status, res.body?.code ?? "error", res.body?.message ?? "Upload failed.", res.body?.details?.fields);
    }
    return res.body as T;
  })();
}
