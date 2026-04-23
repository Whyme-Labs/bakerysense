#!/usr/bin/env npx tsx
/**
 * Record per-scenario videos of the live BakerySense demo.
 * Input:  e2e-demo/test-plan.json
 * Output: e2e-demo/recordings/<scenario>.webm
 *         e2e-demo/screenshots/<scenario>-NN-<step_id>.png
 *         e2e-demo/timing-data.json
 *         e2e-demo/error-log.json
 *         e2e-demo/test-report.md
 */
import { chromium, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import * as path from "node:path";

interface Step {
  action: "navigate" | "click" | "fill" | "select" | "hover" | "scroll" | "press" | "wait";
  target: string;
  value?: string;
  key?: string;
  wait_for: string;
  description: string;
  dwell_ms?: number;
  timeout_ms?: number;
  screenshot?: boolean;
}
interface Scenario { id: string; name: string; description: string; steps: Step[] }
interface TestPlan {
  scenarios: Scenario[];
  config: { base_url: string; viewport: { width: number; height: number }; video: boolean; voiceover: boolean };
}
interface TimingEntry {
  scenario: string;
  step: number;
  step_id: string;
  description: string;
  /** ms from the scenario start (local to this scenario) */
  timestamp_ms: number;
  /** ms from the session recording start (global across session.webm) */
  session_ms: number;
  wait_duration_ms: number;
  dwell_ms: number;
  screenshot?: string;
  video_file: string;
}
interface ErrorEntry { timestamp: string; type: string; message: string; scenario: string; step: number }

const ROOT = path.resolve(__dirname);
const PLAN_PATH = path.join(ROOT, "test-plan.json");
const REC_DIR = path.join(ROOT, "recordings");
const SHOT_DIR = path.join(ROOT, "screenshots");
const TIMING_PATH = path.join(ROOT, "timing-data.json");
const ERROR_PATH = path.join(ROOT, "error-log.json");
const REPORT_PATH = path.join(ROOT, "test-report.md");

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function runStep(
  page: Page, scenario: string, stepIdx: number, step: Step, base: string,
  scenarioStart: number, sessionStart: number,
  timing: TimingEntry[], errors: ErrorEntry[], videoFile: string,
): Promise<void> {
  const t0 = Date.now();
  const stepId = slug(step.description).slice(0, 40);
  const timeout = step.timeout_ms ?? 15_000;
  try {
    if (step.action === "navigate") {
      const url = step.target.startsWith("http") ? step.target : `${base}${step.target}`;
      await page.goto(url, { waitUntil: "load", timeout });
      // Force a reload — page.goto to same pathname + different ?query sometimes
      // resolves via Next's client-side router without a fresh server render,
      // leaving searchParams stale. An explicit reload guarantees the server
      // component picks up the new query string.
      await page.reload({ waitUntil: "load", timeout });
      const final = page.url();
      if (final !== url) console.log(`  [navigate] redirected: ${url} -> ${final}`);
    } else if (step.action === "click") {
      await page.click(step.target, { timeout });
    } else if (step.action === "fill") {
      if (!step.value) throw new Error("fill action needs value");
      await page.fill(step.target, step.value, { timeout });
    } else if (step.action === "select") {
      if (!step.value) throw new Error("select action needs value");
      await page.selectOption(step.target, { index: Number(step.value) }, { timeout });
    } else if (step.action === "hover") {
      await page.hover(step.target, { timeout });
    } else if (step.action === "scroll") {
      await page.locator(step.target).scrollIntoViewIfNeeded({ timeout });
    } else if (step.action === "press") {
      if (!step.key) throw new Error("press action needs key");
      await page.press(step.target, step.key, { timeout });
    } else if (step.action === "wait") {
      // no-op action — just exists so the subsequent waitFor blocks until the
      // target selector appears. Useful for waiting on async UI arrivals
      // (SSE streams, mounted components) without triggering a click/fill.
    }
    const waitT0 = Date.now();
    await page.waitForSelector(step.wait_for, { state: "visible", timeout });
    const waitDur = Date.now() - waitT0;

    if (step.dwell_ms && step.dwell_ms > 0) {
      await page.waitForTimeout(step.dwell_ms);
    }

    let shotPath: string | undefined;
    if (step.screenshot) {
      const name = `${scenario}-${String(stepIdx + 1).padStart(2, "0")}-${stepId}.png`;
      shotPath = path.join(SHOT_DIR, name);
      await page.screenshot({ path: shotPath, fullPage: false });
    }

    timing.push({
      scenario, step: stepIdx + 1, step_id: stepId, description: step.description,
      timestamp_ms: t0 - scenarioStart,
      session_ms: t0 - sessionStart,
      wait_duration_ms: waitDur,
      dwell_ms: step.dwell_ms ?? 0,
      screenshot: shotPath ? path.basename(shotPath) : undefined,
      video_file: videoFile,
    });
    console.log(`  ✓ ${scenario}/${stepIdx + 1} ${step.description} (${Date.now() - t0}ms)`);
  } catch (e) {
    errors.push({
      timestamp: new Date().toISOString(), type: "step-error",
      message: (e as Error).message, scenario, step: stepIdx + 1,
    });
    console.error(`  ✗ ${scenario}/${stepIdx + 1} ${step.description}: ${(e as Error).message}`);
    throw e;
  }
}

async function main(): Promise<void> {
  const plan = JSON.parse(await fs.readFile(PLAN_PATH, "utf-8")) as TestPlan;
  await fs.mkdir(REC_DIR, { recursive: true });
  await fs.mkdir(SHOT_DIR, { recursive: true });

  const timing: TimingEntry[] = [];
  const errors: ErrorEntry[] = [];
  const report: Array<{ scenario: string; ok: boolean; steps: number; durationMs: number; err?: string }> = [];

  const browser = await chromium.launch({ headless: true });

  // A single persistent context so cookies persist across scenarios (we sign in in scenario 1).
  const context = await browser.newContext({
    viewport: plan.config.viewport,
    recordVideo: { dir: REC_DIR, size: plan.config.viewport },
  });
  const page = await context.newPage();
  // Capture session start AFTER newPage — Playwright's recordVideo timer
  // begins here (approximately). timestamp_ms fields in timing-data are
  // absolute within session.webm so compose.ts can cut without drift.
  const sessionStart = Date.now();

  page.on("console", (m) => {
    if (m.type() === "error") {
      errors.push({ timestamp: new Date().toISOString(), type: "console-error", message: m.text(), scenario: "(global)", step: -1 });
    }
  });
  page.on("pageerror", (e) => {
    errors.push({ timestamp: new Date().toISOString(), type: "page-error", message: e.message, scenario: "(global)", step: -1 });
  });

  for (const scenario of plan.scenarios) {
    console.log(`\n=== ${scenario.name} (${scenario.id}) ===`);
    const scenarioStart = Date.now();
    const videoFile = `${scenario.id}.webm`;
    let ok = true;
    let err: string | undefined;
    try {
      for (let i = 0; i < scenario.steps.length; i++) {
        await runStep(page, scenario.id, i, scenario.steps[i], plan.config.base_url, scenarioStart, sessionStart, timing, errors, videoFile);
      }
    } catch (e) {
      ok = false;
      err = (e as Error).message;
    }
    report.push({
      scenario: scenario.name, ok, steps: scenario.steps.length,
      durationMs: Date.now() - scenarioStart, err,
    });
  }

  // Playwright writes one webm per page — we have a single page and want per-scenario cuts.
  // Close the context to flush the video file, then rename to the first scenario's id.
  await page.close();
  await context.close();
  await browser.close();

  // After close, the recordings dir has one webm. Rename to session.webm — the video compiler
  // will use timing-data.json timestamps to cut it per-scenario.
  const files = (await fs.readdir(REC_DIR)).filter((f) => f.endsWith(".webm"));
  if (files.length === 1) {
    const src = path.join(REC_DIR, files[0]);
    const dst = path.join(REC_DIR, "session.webm");
    if (src !== dst) await fs.rename(src, dst);
    // Rewrite video_file for all timing entries to session.webm; the compiler
    // cuts per-scenario using timestamp_ms + next-scenario start.
    for (const t of timing) t.video_file = "session.webm";
  }

  await fs.writeFile(TIMING_PATH, JSON.stringify(timing, null, 2));
  await fs.writeFile(ERROR_PATH, JSON.stringify(errors, null, 2));

  // test-report.md
  const now = new Date().toISOString().slice(0, 10);
  const passed = report.filter((r) => r.ok).length;
  const failed = report.length - passed;
  const lines: string[] = [];
  lines.push(`# E2E Test Report`);
  lines.push(`**Date:** ${now}`);
  lines.push(`**App:** BakerySense (${plan.config.base_url})`);
  lines.push(`**Total scenarios:** ${report.length} | **Passed:** ${passed} | **Failed:** ${failed}`);
  lines.push("");
  for (const r of report) {
    lines.push(`## ${r.scenario} [${r.ok ? "PASS" : "FAIL"}]`);
    lines.push(`- Steps: ${r.steps}, Duration: ${(r.durationMs / 1000).toFixed(1)}s`);
    if (r.err) lines.push(`- Error: ${r.err}`);
    lines.push("");
  }
  await fs.writeFile(REPORT_PATH, lines.join("\n"));

  console.log(`\nDone. ${passed}/${report.length} scenarios passed. Errors: ${errors.length}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
