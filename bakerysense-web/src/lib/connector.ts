import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { base64 } from "@scure/base";
import { NotFound } from "./errors";
import type { PresetId } from "./connector-presets";

export interface Connector {
	id: string;
	tenantId: string;
	label: string;
	preset: PresetId;
	baseUrl: string;
	model: string;
	authMethod: "api_key" | "oauth" | "none";
	encryptedCredential?: string;      // "v1:<base64(iv||ct||tag)>"
	credentialLast4?: string;          // non-secret display only
	createdAt: number;
	lastUsedAt?: number;
}

export interface ConnectorIndex {
	connectorIds: string[];
	defaultId: string | null;
}

function mek(env: CloudflareEnv): Uint8Array {
	if (!env.CONNECTOR_MEK) throw new Error("CONNECTOR_MEK missing");
	const key = base64.decode(env.CONNECTOR_MEK);
	if (key.length !== 32) throw new Error("CONNECTOR_MEK must be 32 bytes (base64)");
	return key;
}

function encrypt(env: CloudflareEnv, plaintext: string): string {
	const iv = randomBytes(12);
	const aes = gcm(mek(env), iv);
	const ct = aes.encrypt(new TextEncoder().encode(plaintext));
	return "v1:" + base64.encode(new Uint8Array([...iv, ...ct]));
}

function decrypt(env: CloudflareEnv, encoded: string): string {
	if (!encoded.startsWith("v1:")) throw new Error("unsupported ciphertext version");
	const buf = base64.decode(encoded.slice(3));
	const iv = buf.slice(0, 12);
	const ct = buf.slice(12);
	const aes = gcm(mek(env), iv);
	return new TextDecoder().decode(aes.decrypt(ct));
}

function newConnectorId(): string {
	return "conn_" + base64.encode(randomBytes(9)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
}

async function readIndex(env: CloudflareEnv, tid: string): Promise<ConnectorIndex> {
	const raw = await env.KV.get(`connector:tenant:${tid}:index`);
	return raw ? (JSON.parse(raw) as ConnectorIndex) : { connectorIds: [], defaultId: null };
}

export async function readConnectorIndex(env: CloudflareEnv, tid: string): Promise<ConnectorIndex> {
	return readIndex(env, tid);
}

async function writeIndex(env: CloudflareEnv, tid: string, idx: ConnectorIndex): Promise<void> {
	await env.KV.put(`connector:tenant:${tid}:index`, JSON.stringify(idx));
}

export async function createConnector(
	env: CloudflareEnv,
	tenantId: string,
	input: {
		label: string; preset: PresetId; baseUrl: string; model: string;
		authMethod: Connector["authMethod"]; credential?: string;
	},
): Promise<Connector> {
	const id = newConnectorId();
	const enc = input.credential ? encrypt(env, input.credential) : undefined;
	const last4 = input.credential ? input.credential.slice(-4) : undefined;
	const now = Date.now();
	const c: Connector = {
		id, tenantId,
		label: input.label, preset: input.preset, baseUrl: input.baseUrl, model: input.model,
		authMethod: input.authMethod,
		encryptedCredential: enc, credentialLast4: last4,
		createdAt: now,
	};
	await env.KV.put(`connector:tenant:${tenantId}:${id}`, JSON.stringify(c));
	const idx = await readIndex(env, tenantId);
	idx.connectorIds.push(id);
	if (!idx.defaultId) idx.defaultId = id;
	await writeIndex(env, tenantId, idx);
	return c;
}

export async function listConnectors(env: CloudflareEnv, tenantId: string): Promise<Connector[]> {
	const idx = await readIndex(env, tenantId);
	const out: Connector[] = [];
	for (const id of idx.connectorIds) {
		const raw = await env.KV.get(`connector:tenant:${tenantId}:${id}`);
		if (raw) out.push(JSON.parse(raw) as Connector);
	}
	return out;
}

export async function getDefaultConnector(env: CloudflareEnv, tenantId: string): Promise<Connector | null> {
	const idx = await readIndex(env, tenantId);
	if (!idx.defaultId) return null;
	const raw = await env.KV.get(`connector:tenant:${tenantId}:${idx.defaultId}`);
	return raw ? (JSON.parse(raw) as Connector) : null;
}

export async function setDefaultConnector(env: CloudflareEnv, tenantId: string, connectorId: string): Promise<void> {
	const idx = await readIndex(env, tenantId);
	if (!idx.connectorIds.includes(connectorId)) throw new NotFound("connector");
	idx.defaultId = connectorId;
	await writeIndex(env, tenantId, idx);
}

export async function deleteConnector(env: CloudflareEnv, tenantId: string, connectorId: string): Promise<void> {
	await env.KV.delete(`connector:tenant:${tenantId}:${connectorId}`);
	const idx = await readIndex(env, tenantId);
	idx.connectorIds = idx.connectorIds.filter((x) => x !== connectorId);
	if (idx.defaultId === connectorId) idx.defaultId = idx.connectorIds[0] ?? null;
	await writeIndex(env, tenantId, idx);
}

export async function resolveUpstreamCredential(
	env: CloudflareEnv,
	c: Connector,
): Promise<string | null> {
	if (!c.encryptedCredential) return null;
	return decrypt(env, c.encryptedCredential);
}
