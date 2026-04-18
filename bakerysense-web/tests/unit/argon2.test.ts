import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/argon2";

describe("argon2id", () => {
	it("hashes and verifies the same password", async () => {
		const hash = await hashPassword("correct-horse-battery-staple");
		expect(hash).toMatch(/^\$argon2id\$/);
		expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
	});

	it("rejects a wrong password", async () => {
		const hash = await hashPassword("correct-horse-battery-staple");
		expect(await verifyPassword("Trombone", hash)).toBe(false);
	});

	it("produces a different hash for the same password (fresh salt)", async () => {
		const h1 = await hashPassword("same");
		const h2 = await hashPassword("same");
		expect(h1).not.toBe(h2);
	});
});
