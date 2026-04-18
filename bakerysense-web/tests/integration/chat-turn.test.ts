import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";

/** Signup and return auth cookies + CSRF token extracted from the response. */
async function signupAndAuth(email: string, slug: string): Promise<{ cookie: string; csrf: string }> {
  const res = await SELF.fetch("https://x.test/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email, password: "Chat2026Chat!!", tenantName: slug, tenantSlug: slug, vertical: "bakery",
    }),
  });
  expect(res.status).toBe(201);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(",").map((s) => s.split(";")[0]).join("; ");
  // bs_csrf is the non-HttpOnly CSRF cookie set by signup — it's extractable client-side
  const csrfMatch = cookie.match(/bs_csrf=([^;]+)/);
  if (!csrfMatch) throw new Error("CSRF cookie missing from signup");
  return { cookie, csrf: decodeURIComponent(csrfMatch[1]) };
}

/** Create a minimal connector so the consumer has somewhere to call. */
async function createConnector(cookie: string, csrf: string): Promise<void> {
  const res = await SELF.fetch("https://x.test/api/connector", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify({
      label: "OR", preset: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "google/gemma-4-e4b-it",
      authMethod: "api_key", credential: "sk-test",
    }),
  });
  expect(res.status).toBe(201);
}

describe("chat — POST /api/chat happy path", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.MIGRATIONS);
    const list = await env.KV.list();
    for (const { name } of list.keys) await env.KV.delete(name);
  });

  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://x.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi", branchId: "brn_demo" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 without CSRF", async () => {
    const { cookie } = await signupAndAuth("c1@x.co", "c1");
    const res = await SELF.fetch("https://x.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ message: "hi", branchId: "brn_demo" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 202 with turnId + streamUrl when authenticated with CSRF", async () => {
    const { cookie, csrf } = await signupAndAuth("c2@x.co", "c2");
    await createConnector(cookie, csrf);

    const res = await SELF.fetch("https://x.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
      body: JSON.stringify({ message: "how many baguettes tomorrow?", branchId: "brn_demo" }),
    });
    expect(res.status).toBe(202);
    const body = await res.json() as { sessionId: string; turnId: string; streamUrl: string };
    expect(body.sessionId).toMatch(/^s_/);
    expect(body.turnId).toMatch(/^t_/);
    expect(body.streamUrl).toContain(body.turnId);
    expect(body.streamUrl).toContain(body.sessionId);
  });

  it("creates a KV turn record with status=queued and a KV session record", async () => {
    const { cookie, csrf } = await signupAndAuth("c3@x.co", "c3");
    await createConnector(cookie, csrf);

    const res = await SELF.fetch("https://x.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
      body: JSON.stringify({ message: "hi", branchId: "brn_demo" }),
    });
    const body = await res.json() as { sessionId: string; turnId: string };

    const turnRaw = await env.KV.get(`chat:turn:${body.sessionId}:${body.turnId}`);
    expect(turnRaw).not.toBeNull();
    const turn = JSON.parse(turnRaw!);
    expect(turn.status).toBe("queued");
    expect(turn.sessionId).toBe(body.sessionId);

    const sessionRaw = await env.KV.get(`chat:session:${body.sessionId}`);
    expect(sessionRaw).not.toBeNull();
  });

  it("validates body — rejects empty message", async () => {
    const { cookie, csrf } = await signupAndAuth("c4@x.co", "c4");
    await createConnector(cookie, csrf);
    const res = await SELF.fetch("https://x.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
      body: JSON.stringify({ message: "", branchId: "brn_demo" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/chat/turn/:turnId returns the queued turn state", async () => {
    const { cookie, csrf } = await signupAndAuth("c5@x.co", "c5");
    await createConnector(cookie, csrf);
    const postRes = await SELF.fetch("https://x.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
      body: JSON.stringify({ message: "hi", branchId: "brn_demo" }),
    });
    const { sessionId, turnId } = await postRes.json() as { sessionId: string; turnId: string };

    const getRes = await SELF.fetch(`https://x.test/api/chat/turn/${turnId}?s=${sessionId}`, {
      headers: { cookie },
    });
    expect(getRes.status).toBe(200);
    const state = await getRes.json() as { status: string; turnId: string };
    expect(state.turnId).toBe(turnId);
    expect(["queued", "running"]).toContain(state.status);
  });
});
