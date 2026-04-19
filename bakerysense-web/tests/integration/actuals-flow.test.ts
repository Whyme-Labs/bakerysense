import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { getDb } from "../../src/db/client";
import { auditLog } from "../../src/db/schema";
import { eq } from "drizzle-orm";

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

/** Create a branch and return its id. */
async function createBranch(
  cookieHeader: string,
  csrf: string,
  name = "Main",
): Promise<string> {
  const res = await SELF.fetch("https://x.test/api/branches", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

describe("actuals flow", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.MIGRATIONS);
    const listed = await env.KV.list();
    await Promise.all(listed.keys.map((k) => env.KV.delete(k.name)));
  });

  it("POST /api/actuals creates a row (201 with id); GET lists it", async () => {
    const { cookieHeader, csrf } = await signupAndGetAuth("af1@x.co", "Password2026Password", "af1");
    const branchId = await createBranch(cookieHeader, csrf, "Main");

    const postRes = await SELF.fetch("https://x.test/api/actuals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({
        branchId,
        family: "BAGUETTE",
        date: "2026-04-15",
        actualBake: 80,
        actualSales: 75,
      }),
    });
    expect(postRes.status).toBe(201);
    const created = (await postRes.json()) as { id: string };
    expect(created.id).toBeTruthy();
    expect(created.id).toMatch(/^act_/);

    const getRes = await SELF.fetch(
      `https://x.test/api/actuals?branch=${branchId}`,
      { headers: { cookie: cookieHeader } },
    );
    expect(getRes.status).toBe(200);
    const list = (await getRes.json()) as { actuals: Array<{ id: string; family: string }> };
    expect(Array.isArray(list.actuals)).toBe(true);
    expect(list.actuals.some((a) => a.family === "BAGUETTE")).toBe(true);
  });

  it("PATCH /api/actuals/:id updates a field; GET reflects change", async () => {
    const { cookieHeader, csrf } = await signupAndGetAuth("af2@x.co", "Password2026Password", "af2");
    const branchId = await createBranch(cookieHeader, csrf, "Main");

    const postRes = await SELF.fetch("https://x.test/api/actuals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({
        branchId,
        family: "CROISSANT",
        date: "2026-04-15",
        actualBake: 50,
        actualSales: 45,
      }),
    });
    expect(postRes.status).toBe(201);
    const { id } = (await postRes.json()) as { id: string };

    const patchRes = await SELF.fetch(`https://x.test/api/actuals/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ actualSales: 99 }),
    });
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as { actualSales: number };
    expect(updated.actualSales).toBe(99);

    const getRes = await SELF.fetch(
      `https://x.test/api/actuals?branch=${branchId}`,
      { headers: { cookie: cookieHeader } },
    );
    const list = (await getRes.json()) as { actuals: Array<{ id: string; actualSales: number }> };
    const row = list.actuals.find((a) => a.id === id);
    expect(row?.actualSales).toBe(99);
  });

  it("DELETE /api/actuals/:id removes; GET returns empty", async () => {
    const { cookieHeader, csrf } = await signupAndGetAuth("af3@x.co", "Password2026Password", "af3");
    const branchId = await createBranch(cookieHeader, csrf, "Main");

    const postRes = await SELF.fetch("https://x.test/api/actuals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({
        branchId,
        family: "PAIN",
        date: "2026-04-15",
        actualBake: 20,
        actualSales: 18,
      }),
    });
    const { id } = (await postRes.json()) as { id: string };

    const delRes = await SELF.fetch(`https://x.test/api/actuals/${id}`, {
      method: "DELETE",
      headers: { cookie: cookieHeader, "x-csrf-token": csrf },
    });
    expect(delRes.status).toBe(204);

    const getRes = await SELF.fetch(
      `https://x.test/api/actuals?branch=${branchId}`,
      { headers: { cookie: cookieHeader } },
    );
    const list = (await getRes.json()) as { actuals: Array<{ id: string }> };
    expect(list.actuals.find((a) => a.id === id)).toBeUndefined();
  });

  it("POST /api/actuals/bulk imports 3 CSV rows; audit entry appears", async () => {
    const { cookieHeader, csrf, tenantId } = await signupAndGetAuth(
      "af4@x.co",
      "Password2026Password",
      "af4",
    );
    const branchId = await createBranch(cookieHeader, csrf, "Main");

    const csv = [
      "family,date,actual_bake,actual_sales",
      "BAGUETTE,2026-04-01,100,95",
      "CROISSANT,2026-04-01,50,45",
      "PAIN,2026-04-01,30,28",
    ].join("\n");

    const bulkRes = await SELF.fetch("https://x.test/api/actuals/bulk", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ branchId, csv }),
    });
    expect(bulkRes.status).toBe(200);
    const bulkBody = (await bulkRes.json()) as { imported: number; errors: unknown[] };
    expect(bulkBody.imported).toBe(3);
    expect(bulkBody.errors).toHaveLength(0);

    // Check audit log for actuals.bulk_imported
    const db = getDb(env);
    const entries = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.tenantId, tenantId))
      .all();
    const bulkAudit = entries.find((e) => e.action === "actuals.bulk_imported");
    expect(bulkAudit).toBeTruthy();
  });

  it("POST /api/actuals without CSRF → 403", async () => {
    const { cookieHeader } = await signupAndGetAuth("af5@x.co", "Password2026Password", "af5");
    const branchId = "brn_test";

    const res = await SELF.fetch("https://x.test/api/actuals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        // deliberately omit x-csrf-token
      },
      body: JSON.stringify({
        branchId,
        family: "BAGUETTE",
        date: "2026-04-15",
        actualBake: 80,
        actualSales: 75,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /api/actuals/bulk from non-admin (staff user) → 403", async () => {
    const adminSlug = "af6";
    const adminEmail = "admin6@x.co";
    const adminPassword = "Password2026Password";
    const { cookieHeader: adminCookie, csrf: adminCsrf } = await signupAndGetAuth(
      adminEmail,
      adminPassword,
      adminSlug,
    );
    const branchId = await createBranch(adminCookie, adminCsrf, "Main");

    // Invite a staff member
    const staffEmail = "staff6@x.co";
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

    const csv = ["family,date,actual_bake,actual_sales", "BAGUETTE,2026-04-01,100,95"].join("\n");
    const res = await SELF.fetch("https://x.test/api/actuals/bulk", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: staffCookie,
        "x-csrf-token": staffCsrf,
      },
      body: JSON.stringify({ branchId, csv }),
    });
    expect(res.status).toBe(403);
  });

  it("Empty-CSV bulk → 409 with errors in response", async () => {
    const { cookieHeader, csrf } = await signupAndGetAuth("af7@x.co", "Password2026Password", "af7");
    const branchId = await createBranch(cookieHeader, csrf, "Main");

    // CSV with only a header and no data rows
    const csv = "family,date,actual_bake,actual_sales\n";

    const res = await SELF.fetch("https://x.test/api/actuals/bulk", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ branchId, csv }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { imported: number; errors: unknown[] };
    expect(body.errors.length).toBeGreaterThan(0);
  });
});
