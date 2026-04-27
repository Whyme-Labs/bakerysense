import { and, eq, desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { dailyActuals } from "@/db/schema";

export type ActualsSource = "manual" | "close_out_photo" | "pos_import" | "csv_import";

export interface ActualsRow {
	tenantId: string;
	branchId: string;
	family: string;
	date: string;
	recommendedBake?: number | null;
	actualBake?: number | null;
	actualSales?: number | null;
	wasteUnits?: number | null;
	source: ActualsSource;
	capturedByUserId?: string | null;
}

function newId(): string {
	const b = crypto.getRandomValues(new Uint8Array(9));
	return "act_" + btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
}

export async function upsertActual(env: CloudflareEnv, row: ActualsRow): Promise<string> {
	const id = newId();
	const now = Date.now();
	await getDb(env).insert(dailyActuals).values({
		id,
		tenantId: row.tenantId,
		branchId: row.branchId,
		family: row.family,
		date: row.date,
		recommendedBake: row.recommendedBake ?? null,
		actualBake: row.actualBake ?? null,
		actualSales: row.actualSales ?? null,
		wasteUnits: row.wasteUnits ?? null,
		source: row.source,
		capturedByUserId: row.capturedByUserId ?? null,
		capturedAt: now,
	}).onConflictDoUpdate({
		target: [dailyActuals.tenantId, dailyActuals.branchId, dailyActuals.family, dailyActuals.date],
		set: {
			recommendedBake: row.recommendedBake ?? null,
			actualBake: row.actualBake ?? null,
			actualSales: row.actualSales ?? null,
			wasteUnits: row.wasteUnits ?? null,
			source: row.source,
			capturedByUserId: row.capturedByUserId ?? null,
			capturedAt: now,
		},
	});
	return id;
}

export async function listActuals(env: CloudflareEnv, tenantId: string, branchId: string, limit = 100): Promise<Array<typeof dailyActuals.$inferSelect>> {
	return getDb(env).select().from(dailyActuals)
		.where(and(eq(dailyActuals.tenantId, tenantId), eq(dailyActuals.branchId, branchId)))
		.orderBy(desc(dailyActuals.date)).limit(limit).all();
}

/**
 * Load the most-recent N actuals for a single (tenant, branch, family),
 * ordered oldest-first. Used by the TimesFM tail forecaster (Sprint 2 +
 * Tier 6) which requires raw history rather than engineered features.
 *
 * Falls back to actualBake when actualSales is null — the latter is the
 * truth, but during onboarding a tenant might only have bake counts.
 */
export async function loadActualsHistory(
	env: CloudflareEnv,
	tenantId: string,
	branchId: string,
	family: string,
	days: number,
): Promise<number[]> {
	const rows = await getDb(env).select().from(dailyActuals)
		.where(and(
			eq(dailyActuals.tenantId, tenantId),
			eq(dailyActuals.branchId, branchId),
			eq(dailyActuals.family, family),
		))
		.orderBy(desc(dailyActuals.date))
		.limit(days)
		.all();
	// rows are newest-first; reverse to oldest-first for the FM input
	const ordered = rows.slice().reverse();
	return ordered.map((r) => {
		const v = r.actualSales ?? r.actualBake ?? 0;
		return Number(v) || 0;
	});
}

export interface CsvParseResult { rows: ActualsRow[]; errors: Array<{ line: number; message: string }> }

export function parseActualsCsv(csv: string, tenantId: string, branchId: string, capturedByUserId: string | null): CsvParseResult {
	const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
	if (lines.length < 2) return { rows: [], errors: [{ line: 0, message: "empty or header-only CSV" }] };
	const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
	const required = ["family", "date", "actual_bake", "actual_sales"];
	const missing = required.filter((r) => !header.includes(r));
	if (missing.length) return { rows: [], errors: [{ line: 1, message: `missing columns: ${missing.join(",")}` }] };
	const idx = (name: string) => header.indexOf(name);
	const rows: ActualsRow[] = [];
	const errors: Array<{ line: number; message: string }> = [];
	for (let i = 1; i < lines.length; i++) {
		const cells = lines[i].split(",").map((c) => c.trim());
		try {
			const toNumOrNull = (s: string | undefined) => {
				if (s == null || s === "") return null;
				const n = Number(s);
				if (!Number.isFinite(n)) throw new Error(`not a number: ${s}`);
				return n;
			};
			rows.push({
				tenantId,
				branchId,
				family: cells[idx("family")] ?? "",
				date: cells[idx("date")] ?? "",
				actualBake: toNumOrNull(cells[idx("actual_bake")]),
				actualSales: toNumOrNull(cells[idx("actual_sales")]),
				wasteUnits: idx("waste_units") >= 0 ? toNumOrNull(cells[idx("waste_units")]) : null,
				source: "csv_import",
				capturedByUserId,
			});
		} catch (e) {
			errors.push({ line: i + 1, message: (e as Error).message });
		}
	}
	return { rows, errors };
}
