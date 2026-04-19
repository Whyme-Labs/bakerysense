export interface FetchOpts extends RequestInit {
  csrf?: string | null;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function readByokHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const result: Record<string, string> = {};
  const key = localStorage.getItem("bs_byok_key");
  const baseUrl = localStorage.getItem("bs_byok_baseurl");
  const model = localStorage.getItem("bs_byok_model");
  if (key) result["x-byo-key"] = key;
  if (baseUrl) result["x-byo-baseurl"] = baseUrl;
  if (model) result["x-byo-model"] = model;
  return result;
}

export async function apiFetch(path: string, opts: FetchOpts = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  const method = (opts.method ?? "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = opts.csrf ?? readCookie("bs_csrf");
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  if (opts.body && !headers.has("content-type") && typeof opts.body === "string") {
    headers.set("content-type", "application/json");
  }
  // Attach BYOK dev-override headers from localStorage (client-side only)
  const byok = readByokHeaders();
  for (const [k, v] of Object.entries(byok)) {
    headers.set(k, v);
  }
  return fetch(path, { ...opts, headers, credentials: "same-origin" });
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

export async function apiJson<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const res = await apiFetch(path, opts);
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return (await res.json()) as T;
}
