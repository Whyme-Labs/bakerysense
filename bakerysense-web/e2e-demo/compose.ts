#!/usr/bin/env npx tsx
/**
 * Pass-through composer: copy session.webm into the Remotion public/ dir and
 * rewrite timing entries so every entry points at session.webm. Remotion's
 * TestVideo slices the source by session_ms via OffthreadVideo.startFrom —
 * no ffmpeg pre-cut needed, which avoids scenario-boundary flashes caused by
 * cutting mid-navigation.
 *
 * Usage: npx tsx e2e-demo/compose.ts
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

interface TimingEntry {
  scenario: string;
  step: number;
  step_id: string;
  description: string;
  timestamp_ms: number;
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
const VO_OUT_DIR = path.join(ROOT, "voiceover", "out");
const VO_PUBLIC_DIR = path.join(ROOT, "video", "public", "voiceover");

async function copyVoiceoverIfPresent(): Promise<void> {
  // If the voiceover generator has run, copy its outputs into Remotion's
  // public/ tree so <Audio src="/voiceover/..."> resolves at render time.
  // Missing manifest is fine — Remotion's TestVideo treats an empty manifest
  // as "no voiceover" and renders silently.
  try {
    await fs.access(path.join(VO_OUT_DIR, "manifest.json"));
  } catch {
    await fs.rm(VO_PUBLIC_DIR, { recursive: true, force: true });
    await fs.mkdir(VO_PUBLIC_DIR, { recursive: true });
    await fs.writeFile(path.join(VO_PUBLIC_DIR, "manifest.json"), "[]\n");
    console.log("No voiceover manifest found — wrote empty manifest.json");
    return;
  }
  await fs.rm(VO_PUBLIC_DIR, { recursive: true, force: true });
  await fs.mkdir(VO_PUBLIC_DIR, { recursive: true });
  for (const f of await fs.readdir(VO_OUT_DIR)) {
    await fs.copyFile(path.join(VO_OUT_DIR, f), path.join(VO_PUBLIC_DIR, f));
  }
  console.log(`Copied voiceover -> ${VO_PUBLIC_DIR}`);
}

async function main(): Promise<void> {
  const timing = JSON.parse(await fs.readFile(TIMING_PATH, "utf-8")) as TimingEntry[];
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  // Clean any prior per-scenario .webm files — Remotion now reads session.webm.
  for (const f of await fs.readdir(PUBLIC_DIR)) {
    if (f.endsWith(".webm") && f !== "session.webm") {
      await fs.unlink(path.join(PUBLIC_DIR, f));
    }
  }
  await fs.copyFile(SESSION, path.join(PUBLIC_DIR, "session.webm"));

  const out = timing.map((e) => ({ ...e, video_file: "session.webm" }));
  await fs.writeFile(OUT_TIMING, JSON.stringify(out, null, 2));
  console.log(`Copied session.webm -> ${PUBLIC_DIR}`);
  console.log(`Wrote ${out.length} timing entries to ${OUT_TIMING}`);

  await copyVoiceoverIfPresent();
}

main().catch((e) => { console.error(e); process.exit(1); });
