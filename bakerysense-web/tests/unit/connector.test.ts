import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
	createConnector, listConnectors, deleteConnector, getDefaultConnector, setDefaultConnector
} from "@/lib/connector";

describe("connector CRUD", () => {
	const TID = "tid-1";
	beforeEach(async () => {
		const list = await env.KV.list({ prefix: `connector:tenant:${TID}` });
		for (const { name } of list.keys) await env.KV.delete(name);
	});

	it("creates and lists", async () => {
		await createConnector(env, TID, {
			label: "My OR", preset: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			model: "google/gemma-4-e4b-it",
			authMethod: "api_key", credential: "sk-or-xxx",
		});
		const items = await listConnectors(env, TID);
		expect(items).toHaveLength(1);
		expect(items[0].label).toBe("My OR");
	});

	it("encrypts the credential at rest (not stored in plaintext)", async () => {
		const c = await createConnector(env, TID, {
			label: "x", preset: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			model: "google/gemma-4-e4b-it",
			authMethod: "api_key", credential: "SECRET_KEY_123",
		});
		const raw = await env.KV.get(`connector:tenant:${TID}:${c.id}`);
		expect(raw).not.toContain("SECRET_KEY_123");
	});

	it("deletes and updates default pointer", async () => {
		const a = await createConnector(env, TID, { label:"a", preset:"openrouter", baseUrl:"x", model:"m", authMethod:"api_key", credential:"k" });
		const b = await createConnector(env, TID, { label:"b", preset:"openrouter", baseUrl:"x", model:"m", authMethod:"api_key", credential:"k" });
		await setDefaultConnector(env, TID, b.id);
		expect((await getDefaultConnector(env, TID))?.id).toBe(b.id);
		await deleteConnector(env, TID, b.id);
		expect((await getDefaultConnector(env, TID))?.id).toBe(a.id);
	});
});
