#!/usr/bin/env node
// Generates SQL that seeds the self-evolving-harness demo: 16 weeks of
// daily_actuals across two branches, with realistic weekly-seasonal demand
// and a deliberately injected over-forecast bias so the harness has a clean,
// known systematic error to detect and correct.
//
// Why synthetic-with-injected-bias (not a real dataset): the harness learns
// from the residual between recommendedBake and actualSales. A demo needs a
// crisp, reproducible, per-branch bias so the proposed correction and the
// before/after WAPE improvement are predictable. Real sales data carries no
// controllable forecast residual.
//
// Injected bias (over-forecast → harness should propose a downward multiplier):
//   - Bukit Bintang : CROISSANT over-forecast +25% every Wednesday
//   - Subang Jaya   : PAIN AU CHOCOLAT over-forecast +22% every Sunday
// Everything else is well-forecast (tiny residual, below the miss threshold).
//
// Usage:
//   TENANT_ID=ten_xxx BUKIT_ID=brn_xxx SUBANG_ID=brn_yyy \
//     node scripts/seed-harness-demo.mjs > /tmp/seed.sql
//   wrangler d1 execute <db> --remote --file=/tmp/seed.sql
//
// Re-runnable: deletes existing demo actuals for these branches first.

const TENANT_ID = process.env.TENANT_ID;
const BUKIT_ID = process.env.BUKIT_ID;
const SUBANG_ID = process.env.SUBANG_ID;
if (!TENANT_ID || !BUKIT_ID || !SUBANG_ID) {
	console.error("Set TENANT_ID, BUKIT_ID, SUBANG_ID env vars.");
	process.exit(1);
}

const WEEKS = 16;
const DAYS = WEEKS * 7; // 112

const FAMILIES = ["TRADITIONAL BAGUETTE", "CROISSANT", "PAIN AU CHOCOLAT"];
const BASE = { "TRADITIONAL BAGUETTE": 140, CROISSANT: 95, "PAIN AU CHOCOLAT": 80 };
// getUTCDay(): 0=Sun..6=Sat
const DOW_WEIGHT = [1.1, 0.9, 0.95, 1.0, 1.0, 1.15, 1.35];

const BRANCHES = [
	{ id: BUKIT_ID, name: "Bukit Bintang", bias: { family: "CROISSANT", dow: 3, factor: 1.25 } }, // Wed
	{ id: SUBANG_ID, name: "Subang Jaya", bias: { family: "CROISSANT", dow: 0, factor: 1.30 } }, // Sun
];

// Deterministic PRNG so the dataset is reproducible.
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0; a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function isoMinusDays(n) {
	const d = new Date();
	d.setUTCHours(0, 0, 0, 0);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}
function dowOf(iso) {
	return new Date(`${iso}T00:00:00Z`).getUTCDay();
}
function sqlStr(s) {
	return `'${String(s).replace(/'/g, "''")}'`;
}

const lines = [];
lines.push("-- Self-evolving harness demo seed (generated). Re-runnable.");
lines.push("PRAGMA defer_foreign_keys = TRUE;");

// Ensure Subang branch exists (Bukit Bintang already created via the app).
lines.push(
	`INSERT OR IGNORE INTO branches (id, tenant_id, name, created_at) VALUES (${sqlStr(SUBANG_ID)}, ${sqlStr(TENANT_ID)}, ${sqlStr("Subang Jaya")}, ${Date.now()});`,
);

// Clear prior demo actuals for these branches so re-runs are clean.
for (const b of BRANCHES) {
	lines.push(`DELETE FROM daily_actuals WHERE tenant_id = ${sqlStr(TENANT_ID)} AND branch_id = ${sqlStr(b.id)};`);
}

const now = Date.now();
let n = 0;
for (const b of BRANCHES) {
	const rand = mulberry32(0xbade + b.id.length);
	for (let day = 1; day <= DAYS; day++) {
		const date = isoMinusDays(day);
		const dow = dowOf(date);
		for (const family of FAMILIES) {
			const demand = BASE[family] * DOW_WEIGHT[dow] * (0.97 + rand() * 0.06); // ±3% noise
			const actualSales = Math.round(demand);
			const biased = family === b.bias.family && dow === b.bias.dow;
			// Recommendation: ~unbiased on clean cells (tiny +2% margin); a
			// systematic over-forecast on the injected cell.
			const recommendedBake = biased
				? Math.round(actualSales * b.bias.factor)
				: Math.round(actualSales * 1.02);
			const actualBake = recommendedBake; // operator follows the recommendation
			const wasteUnits = Math.max(actualBake - actualSales, 0);
			const id = `dah_${b.id.slice(-6)}_${n}`;
			n++;
			lines.push(
				`INSERT INTO daily_actuals (id, tenant_id, branch_id, family, date, recommended_bake, actual_bake, actual_sales, waste_units, source, captured_at) VALUES (` +
					`${sqlStr(id)}, ${sqlStr(TENANT_ID)}, ${sqlStr(b.id)}, ${sqlStr(family)}, ${sqlStr(date)}, ` +
					`${recommendedBake}, ${actualBake}, ${actualSales}, ${wasteUnits}, 'manual', ${now});`,
			);
		}
	}
}

lines.push(`-- ${n} daily_actuals rows across ${BRANCHES.length} branches × ${FAMILIES.length} families × ${DAYS} days.`);
process.stdout.write(lines.join("\n") + "\n");
