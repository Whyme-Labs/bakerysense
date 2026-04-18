import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { setAuthCookie, readAuthCookie } from "@/lib/auth/cookies";

describe("cookies", () => {
	it("writes and reads back a signed cookie value", async () => {
		const headers = new Headers();
		await setAuthCookie(env, headers, "bs_at", "hello", { maxAgeSeconds: 60 });
		const setCookie = headers.get("set-cookie")!;
		expect(setCookie).toMatch(/bs_at=/);
		expect(setCookie).toMatch(/HttpOnly/);
		expect(setCookie).toMatch(/Secure/);
		expect(setCookie).toMatch(/SameSite=Strict/);
		const [, value] = setCookie.match(/bs_at=([^;]+)/)!;
		const parsed = await readAuthCookie(env, `bs_at=${value}`, "bs_at");
		expect(parsed).toBe("hello");
	});

	it("rejects a tampered cookie value", async () => {
		const headers = new Headers();
		await setAuthCookie(env, headers, "bs_at", "hello");
		const [, value] = headers.get("set-cookie")!.match(/bs_at=([^;]+)/)!;
		const tampered = value.replace(/.$/, "X");
		const parsed = await readAuthCookie(env, `bs_at=${tampered}`, "bs_at");
		expect(parsed).toBeNull();
	});
});
