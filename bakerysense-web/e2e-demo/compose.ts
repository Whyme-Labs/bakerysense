#!/usr/bin/env npx tsx
/**
 * Cut session.webm into per-scenario webm files using ffmpeg, then emit
 * timing-remotion.json with the per-scenario video_file suitable for the
 * Remotion TestVideo composition.
 *
 * Usage: npx tsx e2e-demo/compose.ts
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

interface TimingEntry {
  scenario: string;
  step: number;
  step_id: string;
  description: string;
  /** ms from scenario start */
  timestamp_ms: number;
  /** ms from session.webm start (globally anchored) */
  session_ms: number;
  wait_duration_ms: number;
  dwell_ms: number;
  screenshot?: string;
  video_file: string;
}

const ROOT = path.resolve(__dirname);
const SESSION = path.join(ROOT, "recordings", "session.webm");
const PUBLIC_DIR = path.join(ROOT, "video", "public", "recordings");
const TIMING_PATH = path.join(ROOT, "timing-data.json");
const OUT_TIMING = path.join(ROOT, "video", "public", "timing-data.json");

async function main(): Promise<void> {
  const timing = JSON.parse(await fs.readFile(TIMING_PATH, "utf-8")) as TimingEntry[];
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  const scenarios = new Map<string, TimingEntry[]>();
  for (const e of timing) {
    if (!scenarios.has(e.scenario)) scenarios.set(e.scenario, []);
    scenarios.get(e.scenario)!.push(e);
  }

  // Use absolute session_ms timestamps so cuts don't drift across scenarios.
  // Each cut: start = first step's session_ms; end = last step's session_ms
  // + wait + dwell + 500ms tail.
  const remotionTiming: TimingEntry[] = [];
  for (const [scenarioId, entries] of scenarios) {
    const first = entries[0];
    const last = entries[entries.length - 1];
    const startMs = first.session_ms;
    const endMs = last.session_ms + last.wait_duration_ms + (last.dwell_ms || 0) + 500;
    const startSec = (startMs / 1000).toFixed(3);
    const durSec = ((endMs - startMs) / 1000).toFixed(3);
    const outWebm = path.join(PUBLIC_DIR, `${scenarioId}.webm`);
    console.log(`Cutting ${scenarioId}: start=${startSec}s dur=${durSec}s`);
    execFileSync("ffmpeg", [
      "-y", "-ss", startSec, "-i", SESSION, "-t", durSec, "-c", "copy", outWebm,
    ], { stdio: ["ignore", "ignore", "ignore"] });
    for (const e of entries) remotionTiming.push({ ...e, video_file: `${scenarioId}.webm` });
  }

  await fs.writeFile(OUT_TIMING, JSON.stringify(remotionTiming, null, 2));
  console.log(`\nWrote ${remotionTiming.length} timing entries to ${OUT_TIMING}`);
  console.log(`Recordings: ${PUBLIC_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
