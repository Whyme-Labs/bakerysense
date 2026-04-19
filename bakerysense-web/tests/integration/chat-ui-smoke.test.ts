import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";

/** Signup and return auth cookies + CSRF token extracted from the response. */
async function signupAndGetAuth(
  email = "t@t.co",
  password = "Password2026Password",
  slug = "t",
): Promise<{ cookieHeader: string; csrf: string; cookies: Record<string, string> }> {
  const res = await SELF.fetch("https://x.test/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      tenantName: slug.toUpperCase(),
      tenantSlug: slug,
      vertical: "bakery",
    }),
  });
  expect(res.status).toBe(201);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const parts = setCookie.split(",").map((s) => s.trim());
  const cookies: Record<string, string> = {};
  for (const part of parts) {
    const nameVal = part.split(";")[0];
    const eqIdx = nameVal.indexOf("=");
    if (eqIdx !== -1) {
      const k = nameVal.slice(0, eqIdx).trim();
      const v = nameVal.slice(eqIdx + 1).trim();
      if (k) cookies[k] = v;
    }
  }
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const csrf = cookies["bs_csrf"] ? decodeURIComponent(cookies["bs_csrf"]) : "";
  return { cookieHeader, csrf, cookies };
}

/** Create a minimal connector so the chat handler can resolve the default LLM. */
async function createConnector(cookieHeader: string, csrf: string): Promise<void> {
  const res = await SELF.fetch("https://x.test/api/connector", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify({
      label: "OR",
      preset: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "google/gemma-4-e4b-it",
      authMethod: "api_key",
      credential: "sk-test",
    }),
  });
  expect(res.status).toBe(201);
}

describe("chat UI smoke — POST /api/chat shape that ChatThread.tsx relies on", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.MIGRATIONS);
    const listed = await env.KV.list();
    await Promise.all(listed.keys.map((k) => env.KV.delete(k.name)));
  });

  it("POST /api/chat without authentication returns 401", async () => {
    const res = await SELF.fetch("https://x.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi", branchId: "brn_demo" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/chat without CSRF token returns 403", async () => {
    const { cookieHeader } = await signupAndGetAuth("cu1@x.co", "Password2026Password", "cu1");
    const res = await SELF.fetch("https://x.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({ message: "hi", branchId: "brn_demo" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /api/chat returns sessionId, turnId, streamUrl matching /api/chat/stream/", async () => {
    const { cookieHeader, csrf } = await signupAndGetAuth("cu2@x.co", "Password2026Password", "cu2");
    await createConnector(cookieHeader, csrf);

    // Create a branch so we can reference a real branchId
    const brRes = await SELF.fetch("https://x.test/api/branches", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ name: "Main" }),
    });
    expect(brRes.status).toBe(201);
    const { id: branchId } = (await brRes.json()) as { id: string };

    const res = await SELF.fetch("https://x.test/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ message: "hi", branchId }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { sessionId: string; turnId: string; streamUrl: string };
    expect(body.sessionId).toBeTruthy();
    expect(body.turnId).toBeTruthy();
    expect(body.streamUrl).toMatch(/\/api\/chat\/stream\//);
    // streamUrl must embed both the turnId and sessionId so the client can poll
    expect(body.streamUrl).toContain(body.turnId);
    expect(body.streamUrl).toContain(body.sessionId);
  });

  it("POST /api/chat streamUrl contains the turnId in path (ChatThread SSE connection)", async () => {
    const { cookieHeader, csrf } = await signupAndGetAuth("cu3@x.co", "Password2026Password", "cu3");
    await createConnector(cookieHeader, csrf);

    const brRes = await SELF.fetch("https://x.test/api/branches", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ name: "Branch B" }),
    });
    const { id: branchId } = (await brRes.json()) as { id: string };

    const res = await SELF.fetch("https://x.test/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ message: "hello bakery bot", branchId }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { sessionId: string; turnId: string; streamUrl: string };
    // The streamUrl path must be /api/chat/stream/<turnId>?s=<sessionId>
    const expectedPath = `/api/chat/stream/${body.turnId}`;
    expect(body.streamUrl).toContain(expectedPath);
  });
});
