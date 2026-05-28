#!/usr/bin/env node
// Emits the minimal forecast bundle (trees + features) for a demo tenant so
// the dashboard / bake-plan pages render real forecasts — mirrors
// seedForecastBundle in src/scripts/seed-demo.ts. Writes two JSON files;
// push them to R2 at the fallback keys read by src/lib/features.ts:
//   tenant:<TENANT_ID>/trees/latest.json
//   tenant:<TENANT_ID>/features/latest.json
//
//   TENANT_ID=ten_xxx BRANCH_IDS=brnA,brnB node scripts/seed-demo-forecast-bundle.mjs <outdir>
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TENANT_ID = process.env.TENANT_ID;
const BRANCH_IDS = (process.env.BRANCH_IDS ?? "").split(",").filter(Boolean);
const OUT = process.argv[2] ?? "/tmp/demo-bundle";
if (!TENANT_ID || BRANCH_IDS.length === 0) {
	console.error("Set TENANT_ID and BRANCH_IDS (comma-separated).");
	process.exit(1);
}

const FAMILY_BASE = { "TRADITIONAL BAGUETTE": 140, CROISSANT: 95, "PAIN AU CHOCOLAT": 80 };
const QUANTILE_SCALES = { "0.1": 0.82, "0.3": 0.91, "0.5": 1.0, "0.6": 1.05, "0.7": 1.1, "0.8": 1.15, "0.9": 1.22 };

// Trees: per-quantile single-leaf model; leaf = mean family base × scale.
const meanBase = Object.values(FAMILY_BASE).reduce((a, b) => a + b, 0) / Object.keys(FAMILY_BASE).length;
const quantiles = {};
for (const [q, scale] of Object.entries(QUANTILE_SCALES)) {
	quantiles[q] = {
		feature_names: ["lag_7"],
		num_trees: 1,
		trees: [{ split_feature: [], threshold: [], decision_type: [], left_child: [], right_child: [], leaf_value: [meanBase * scale] }],
	};
}

// Features: per branch × family × date across -14..+7 days.
const perBranchFamilyDate = {};
const today = new Date();
const dates = [];
for (let d = -14; d <= 7; d++) {
	dates.push(new Date(today.getTime() + d * 86400_000).toISOString().slice(0, 10));
}
for (const branchId of BRANCH_IDS) {
	for (const family of Object.keys(FAMILY_BASE)) {
		for (const date of dates) {
			perBranchFamilyDate[`${branchId}|${family}|${date}`] = { lag_7: FAMILY_BASE[family] };
		}
	}
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "trees.json"), JSON.stringify({ quantiles }));
writeFileSync(join(OUT, "features.json"), JSON.stringify({ last_date: dates[dates.length - 1], per_branch_family_date: perBranchFamilyDate }));
console.log("trees key   :", `tenant:${TENANT_ID}/trees/latest.json`);
console.log("features key:", `tenant:${TENANT_ID}/features/latest.json`);
console.log("wrote", OUT, "·", Object.keys(perBranchFamilyDate).length, "feature rows");
