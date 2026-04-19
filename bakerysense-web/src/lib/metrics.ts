import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { dailyActuals, forecastSnapshots } from "@/db/schema";

export interface PointResult { date: string; predicted: number; actual: number; absError: number }

export async function loadJoinedPoints(
  env: CloudflareEnv, tenantId: string, branchId: string, family: string, sinceIso: string,
): Promise<PointResult[]> {
  const db = getDb(env);
  const fcs = await db.select().from(forecastSnapshots).where(and(
    eq(forecastSnapshots.tenantId, tenantId),
    eq(forecastSnapshots.branchId, branchId),
    eq(forecastSnapshots.family, family),
    gte(forecastSnapshots.date, sinceIso),
  )).all();
  const acts = await db.select().from(dailyActuals).where(and(
    eq(dailyActuals.tenantId, tenantId),
    eq(dailyActuals.branchId, branchId),
    eq(dailyActuals.family, family),
    gte(dailyActuals.date, sinceIso),
  )).all();
  const byDate = new Map<string, number>();
  for (const a of acts) if (a.actualSales != null) byDate.set(a.date, a.actualSales);
  const out: PointResult[] = [];
  for (const f of fcs) {
    const actual = byDate.get(f.date);
    if (actual == null) continue;
    out.push({ date: f.date, predicted: f.bakeQuantity, actual, absError: Math.abs(f.bakeQuantity - actual) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function wape(points: PointResult[]): number {
  const num = points.reduce((s, p) => s + p.absError, 0);
  const den = points.reduce((s, p) => s + Math.abs(p.actual), 0);
  return den === 0 ? 0 : num / den;
}

export function driftDetected(current: number, baseline: number): boolean {
  return baseline > 0 && current / baseline >= 1.5;
}

// Returns per-family rolling WAPE for a branch over a window (days back from today).
export async function rollingWapePerFamily(
  env: CloudflareEnv, tenantId: string, branchId: string, window: number, familyFilter?: string,
): Promise<Array<{ family: string; wape: number; sampleCount: number }>> {
  const db = getDb(env);
  const since = new Date(Date.now() - window * 86400_000).toISOString().slice(0, 10);
  // Discover candidate families: union of snapshots and actuals in window.
  const snaps = await db.select().from(forecastSnapshots).where(and(
    eq(forecastSnapshots.tenantId, tenantId),
    eq(forecastSnapshots.branchId, branchId),
    gte(forecastSnapshots.date, since),
  )).all();
  const acts = await db.select().from(dailyActuals).where(and(
    eq(dailyActuals.tenantId, tenantId),
    eq(dailyActuals.branchId, branchId),
    gte(dailyActuals.date, since),
  )).all();
  const families = new Set<string>();
  for (const s of snaps) families.add(s.family);
  for (const a of acts) families.add(a.family);
  const filtered = familyFilter ? [familyFilter] : [...families];
  const out: Array<{ family: string; wape: number; sampleCount: number }> = [];
  for (const fam of filtered) {
    const pts = await loadJoinedPoints(env, tenantId, branchId, fam, since);
    out.push({ family: fam, wape: wape(pts), sampleCount: pts.length });
  }
  return out.sort((a, b) => a.family.localeCompare(b.family));
}
