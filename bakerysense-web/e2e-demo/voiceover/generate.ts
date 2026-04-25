#!/usr/bin/env npx tsx
/**
 * Generate per-section voiceover audio via DashScope's qwen-tts-flash model.
 *
 * Input:  e2e-demo/voiceover/script.json
 * Output: e2e-demo/voiceover/out/<section_id>.mp3
 *         e2e-demo/voiceover/out/manifest.json (durations, ready for Remotion)
 *
 * Required env: DASHSCOPE_API_KEY
 *               (get one at https://dashscope.console.aliyun.com/)
 *
 * Run: cd bakerysense-web && DASHSCOPE_API_KEY=sk-... npx tsx e2e-demo/voiceover/generate.ts
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

const API = "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
// DashScope qwen-tts requires the international endpoint for non-CN accounts;
// CN accounts can use https://dashscope.aliyuncs.com — the request shape is identical.

interface Section {
  id: string;
  voice: string;
  speaker: "owner" | "vo";
  scenario_anchor: string;
  text: string;
}

interface ScriptFile {
  default_voice: string;
  model: string;
  sections: Section[];
}

interface ManifestEntry {
  id: string;
  voice: string;
  speaker: "owner" | "vo";
  scenario_anchor: string;
  text: string;
  audio_file: string;
  duration_ms: number;
  byte_size: number;
}

const ROOT = path.resolve(__dirname);
const SCRIPT_PATH = path.join(ROOT, "script.json");
const OUT_DIR = path.join(ROOT, "out");
const MANIFEST_PATH = path.join(OUT_DIR, "manifest.json");

async function ttsToMp3(model: string, voice: string, text: string, out: string): Promise<void> {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error("DASHSCOPE_API_KEY env var is required");

  const body = {
    model,
    input: { text, voice },
  };
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`DashScope ${res.status}: ${errText.slice(0, 400)}`);
  }
  const json = await res.json() as { output?: { audio?: { url?: string } } };
  const audioUrl = json.output?.audio?.url;
  if (!audioUrl) {
    throw new Error(`DashScope response missing output.audio.url: ${JSON.stringify(json).slice(0, 400)}`);
  }
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`audio fetch failed: ${audioRes.status}`);
  const buf = Buffer.from(await audioRes.arrayBuffer());
  await fs.writeFile(out, buf);
}

async function probeDurationMs(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += String(d); });
    proc.stderr.on("data", (d) => { stderr += String(d); });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exit ${code}: ${stderr}`));
        return;
      }
      const sec = parseFloat(stdout.trim());
      if (!Number.isFinite(sec)) {
        reject(new Error(`ffprobe parse failed: '${stdout}'`));
        return;
      }
      resolve(Math.round(sec * 1000));
    });
  });
}

async function main(): Promise<void> {
  const script = JSON.parse(await fs.readFile(SCRIPT_PATH, "utf-8")) as ScriptFile;
  await fs.mkdir(OUT_DIR, { recursive: true });

  const manifest: ManifestEntry[] = [];
  for (const s of script.sections) {
    const voice = s.voice ?? script.default_voice;
    const audioPath = path.join(OUT_DIR, `${s.id}.mp3`);
    console.log(`[tts] ${s.id} (voice=${voice}, ${s.text.length} chars) → ${path.basename(audioPath)}`);
    await ttsToMp3(script.model, voice, s.text, audioPath);
    const stat = await fs.stat(audioPath);
    const durationMs = await probeDurationMs(audioPath);
    manifest.push({
      id: s.id,
      voice,
      speaker: s.speaker,
      scenario_anchor: s.scenario_anchor,
      text: s.text,
      audio_file: path.basename(audioPath),
      duration_ms: durationMs,
      byte_size: stat.size,
    });
    console.log(`  ✓ ${(stat.size / 1024).toFixed(1)} KB, ${durationMs} ms`);
  }
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nDone. Manifest at ${path.relative(process.cwd(), MANIFEST_PATH)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
