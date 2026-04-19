import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { handleRetrainMessage } from "../../src/lib/retrain";

interface AuthResult {
  cookieHeader: string;
  csrf: string;
  tenantId: string;
  userId: string;
}

/** Signup and return auth cookies + CSRF token + tenantId. */
async function signupAndGetAuth(
  email = "t@t.co",
  password = "Password2026Password",
  slug = "t",
): Promise<AuthResult> {
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
  const body = (await res.json()) as { tenantId: string; userId: string };
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
  return { cookieHeader, csrf, tenantId: body.tenantId, userId: body.userId };
}

/** Sign in an existing user and return cookies + CSRF. */
async function signinAndGetAuth(
  email: string,
  password: string,
  tenantSlug: string,
): Promise<{ cookieHeader: string; csrf: string }> {
  const res = await SELF.fetch("https://x.test/api/auth/signin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, tenantSlug }),
  });
  expect(res.status).toBe(200);
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
  return { cookieHeader, csrf };
}

// ---------------------------------------------------------------------------
// HMAC signing helpers (mirrors the server-side implementation in publish-model/route.ts)
// ---------------------------------------------------------------------------
function canonicalize(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(canonicalize).join(",") + "]";
  const keys = Object.keys(o as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonicalize((o as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}

function sign(body: unknown, secret: string): string {
  const canon = canonicalize(body);
  const mac = hmac(
    sha256,
    new TextEncoder().encode(secret),
    new TextEncoder().encode(canon),
  );
  return bytesToHex(mac);
}

describe("retrain pipeline", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.MIGRATIONS);
    const listed = await env.KV.list();
    await Promise.all(listed.keys.map((k) => env.KV.delete(k.name)));
  });

  it("Enqueue + state transitions: queued → awaiting_publish; R2 object written", async () => {
    const { cookieHeader, csrf, tenantId } = await signupAndGetAuth(
      "rp1@x.co",
      "Password2026Password",
      "rp1",
    );

    // POST /api/admin/retrain → 202
    const retrainRes = await SELF.fetch("https://x.test/api/admin/retrain", {
      method: "POST",
      headers: { cookie: cookieHeader, "x-csrf-token": csrf },
    });
    expect(retrainRes.status).toBe(202);

    // Assert KV state is "queued"
    const queuedState = await env.KV.get<{ status: string }>(
      `retrain:last:${tenantId}`,
      "json",
    );
    expect(queuedState?.status).toBe("queued");

    // Directly call handleRetrainMessage (Miniflare queue consumer doesn't execute)
    await handleRetrainMessage(env, {
      type: "retrain",
      tenantId,
      triggeredBy: "manual",
      triggeredAt: Date.now(),
    });

    // Assert KV state is now "awaiting_publish"
    const awaitingState = await env.KV.get<{ status: string }>(
      `retrain:last:${tenantId}`,
      "json",
    );
    expect(awaitingState?.status).toBe("awaiting_publish");

    // Assert R2 object was created
    const objs = await env.MODELS.list({ prefix: `tenant:${tenantId}/training-inputs/` });
    expect(objs.objects.length).toBe(1);
  });

  it("Publish success: model:active and model:versions set; state = published", async () => {
    const { cookieHeader, csrf, tenantId } = await signupAndGetAuth(
      "rp2@x.co",
      "Password2026Password",
      "rp2",
    );

    // Enqueue to set up awaiting_publish state
    await SELF.fetch("https://x.test/api/admin/retrain", {
      method: "POST",
      headers: { cookie: cookieHeader, "x-csrf-token": csrf },
    });
    await handleRetrainMessage(env, {
      type: "retrain",
      tenantId,
      triggeredBy: "manual",
      triggeredAt: Date.now(),
    });

    const secret = env.OPS_ROTATE_SECRET ?? "test-ops-secret";
    const publishBody = {
      tenantId,
      newVersion: 2,
      treesR2Key: `tenant:${tenantId}/models/v2/trees.bin`,
      featuresR2Key: `tenant:${tenantId}/models/v2/features.json`,
      trainedAt: Date.now(),
      metrics: { rollingMae: 10, rollingWape: 0.2 },
    };
    const sig = sign(publishBody, secret);

    const publishRes = await SELF.fetch("https://x.test/api/internal/publish-model", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ops-secret": sig,
      },
      body: JSON.stringify(publishBody),
    });
    expect(publishRes.status).toBe(200);
    const publishResult = (await publishRes.json()) as { ok: boolean; version: number };
    expect(publishResult.ok).toBe(true);
    expect(publishResult.version).toBe(2);

    // Assert model:active:<tid> is set
    const activePointer = await env.KV.get<{ version: number }>(
      `model:active:${tenantId}`,
      "json",
    );
    expect(activePointer?.version).toBe(2);

    // Assert model:versions:<tid> has the entry
    const versions = await env.KV.get<Array<{ version: number }>>(
      `model:versions:${tenantId}`,
      "json",
    );
    expect(versions?.some((v) => v.version === 2)).toBe(true);

    // Assert retrain:last:<tid> is published
    const finalState = await env.KV.get<{ status: string }>(
      `retrain:last:${tenantId}`,
      "json",
    );
    expect(finalState?.status).toBe("published");
  });

  it("Publish with bad HMAC → 401", async () => {
    const { tenantId } = await signupAndGetAuth("rp3@x.co", "Password2026Password", "rp3");

    const publishBody = {
      tenantId,
      newVersion: 1,
      treesR2Key: `tenant:${tenantId}/models/v1/trees.bin`,
      featuresR2Key: `tenant:${tenantId}/models/v1/features.json`,
      trainedAt: Date.now(),
      metrics: { rollingMae: 5, rollingWape: 0.1 },
    };

    const res = await SELF.fetch("https://x.test/api/internal/publish-model", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ops-secret": "bad-signature-value-that-is-definitely-wrong-but-correct-length-xx",
      },
      body: JSON.stringify(publishBody),
    });
    expect(res.status).toBe(401);
  });

  it("Rollback guard → 409 when rollingMae > 1.1 * baseline; state = aborted; active unchanged", async () => {
    const { cookieHeader, csrf, tenantId } = await signupAndGetAuth(
      "rp4@x.co",
      "Password2026Password",
      "rp4",
    );

    // Enqueue and run handleRetrainMessage to set awaiting_publish
    await SELF.fetch("https://x.test/api/admin/retrain", {
      method: "POST",
      headers: { cookie: cookieHeader, "x-csrf-token": csrf },
    });
    await handleRetrainMessage(env, {
      type: "retrain",
      tenantId,
      triggeredBy: "manual",
      triggeredAt: Date.now(),
    });

    const secret = env.OPS_ROTATE_SECRET ?? "test-ops-secret";
    // rollingMae: 10 > 1.1 * baselineRollingMae: 5 = 5.5 → regression guard
    const publishBody = {
      tenantId,
      newVersion: 2,
      treesR2Key: `tenant:${tenantId}/models/v2/trees.bin`,
      featuresR2Key: `tenant:${tenantId}/models/v2/features.json`,
      trainedAt: Date.now(),
      metrics: { rollingMae: 10, rollingWape: 0.2 },
      baselineRollingMae: 5,
    };
    const sig = sign(publishBody, secret);

    const res = await SELF.fetch("https://x.test/api/internal/publish-model", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ops-secret": sig,
      },
      body: JSON.stringify(publishBody),
    });
    expect(res.status).toBe(409);

    // Assert retrain state is "aborted"
    const abortedState = await env.KV.get<{ status: string; reason: string }>(
      `retrain:last:${tenantId}`,
      "json",
    );
    expect(abortedState?.status).toBe("aborted");
    expect(abortedState?.reason).toBeTruthy();

    // Assert model:active:<tid> is NOT set (still null since we never published)
    const activePointer = await env.KV.get(`model:active:${tenantId}`);
    expect(activePointer).toBeNull();
  });

  it("Non-admin POST /api/admin/retrain → 403 (staff user)", async () => {
    const adminSlug = "rp5";
    const adminEmail = "admin5@x.co";
    const adminPassword = "Password2026Password";
    const { cookieHeader: adminCookie, csrf: adminCsrf } = await signupAndGetAuth(
      adminEmail,
      adminPassword,
      adminSlug,
    );

    // Invite a staff member
    const staffEmail = "staff5@x.co";
    const inviteRes = await SELF.fetch("https://x.test/api/users", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
        "x-csrf-token": adminCsrf,
      },
      body: JSON.stringify({ email: staffEmail, role: "staff" }),
    });
    expect(inviteRes.status).toBe(201);
    const invite = (await inviteRes.json()) as { tempPassword: string | null };
    if (!invite.tempPassword) return; // skip if can't get staff creds

    const { cookieHeader: staffCookie, csrf: staffCsrf } = await signinAndGetAuth(
      staffEmail,
      invite.tempPassword,
      adminSlug,
    );

    const res = await SELF.fetch("https://x.test/api/admin/retrain", {
      method: "POST",
      headers: { cookie: staffCookie, "x-csrf-token": staffCsrf },
    });
    expect(res.status).toBe(403);
  });
});
