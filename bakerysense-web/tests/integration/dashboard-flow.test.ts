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
  // Split on comma but only where a new cookie name starts (e.g. "Name=")
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

/** Create a connector so tool-ctx resolution has a valid default connector. */
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

describe("dashboard flow", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.MIGRATIONS);
    const listed = await env.KV.list();
    await Promise.all(listed.keys.map((k) => env.KV.delete(k.name)));
  });

  it("unauthenticated forecast batch returns 401", async () => {
    const res = await SELF.fetch(
      "https://x.test/api/forecast/batch?branch=X&on_date=2026-04-19",
    );
    expect(res.status).toBe(401);
  });

  it("forecast batch with missing params returns 400", async () => {
    const { cookieHeader } = await signupAndGetAuth("d1@x.co", "Password2026Password", "d1");
    // missing on_date
    const res = await SELF.fetch(
      "https://x.test/api/forecast/batch?branch=brn_test",
      { headers: { cookie: cookieHeader } },
    );
    expect(res.status).toBe(400);
  });

  it("authenticated batch forecast returns 200 with a structured body", async () => {
    const { cookieHeader, csrf } = await signupAndGetAuth("d2@x.co", "Password2026Password", "d2");
    await createConnector(cookieHeader, csrf);

    // Create a branch
    const brRes = await SELF.fetch("https://x.test/api/branches", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ name: "Main", city: "Lima" }),
    });
    expect(brRes.status).toBe(201);
    const { id: branchId } = (await brRes.json()) as { id: string };

    const today = new Date().toISOString().slice(0, 10);
    const res = await SELF.fetch(
      `https://x.test/api/forecast/batch?branch=${branchId}&on_date=${today}`,
      { headers: { cookie: cookieHeader } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { forecasts: unknown[] };
    expect(body).toHaveProperty("forecasts");
    expect(Array.isArray(body.forecasts)).toBe(true);
  });

  it("GET /api/skus returns 200 with structured body (authenticated call gets past auth gate)", async () => {
    const { cookieHeader, csrf } = await signupAndGetAuth("d3@x.co", "Password2026Password", "d3");
    await createConnector(cookieHeader, csrf);

    // Create a branch
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

    const res = await SELF.fetch(`https://x.test/api/skus?branch=${branchId}`, {
      headers: { cookie: cookieHeader },
    });
    // The route returns 200 always (tool errors are soft-returned inside the JSON body).
    // In tests the R2 MODELS bucket is empty so list_skus returns { error: "..." } rather
    // than { skus: [] }. Either way the HTTP pipe is verified: auth passed, JSON returned.
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // body is either { skus: string[] } when R2 has data, or { error: string } when empty
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
    // Confirm it is NOT a 401/403 rejection masquerading as 200 (body would have auth-error shape)
    expect(body).not.toHaveProperty("code", "unauthorized");
  });

  it("GET /api/skus without branch param returns 400", async () => {
    const { cookieHeader } = await signupAndGetAuth("d4@x.co", "Password2026Password", "d4");
    const res = await SELF.fetch("https://x.test/api/skus", {
      headers: { cookie: cookieHeader },
    });
    expect(res.status).toBe(400);
  });
});
