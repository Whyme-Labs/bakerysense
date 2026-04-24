import React from "react";
import { Composition, staticFile } from "remotion";
import { TestVideo } from "./TestVideo";
import type { TimingEntry } from "./types";
import defaultTiming from "../public/timing-data.json";

const FPS = 30;
const TITLE_CARD_FRAMES = 45; // 1.5s
const INTRO_FRAMES = 90;  // 3s brand intro
const OUTRO_FRAMES = 90;  // 3s brand outro
const BROLL_SHOT1 = 10 * FPS;
const BROLL_SHOT7B = 5 * FPS;
const BROLL_SHOT9 = 10 * FPS;

function computeTotalFrames(timingData: TimingEntry[]): number {
  if (timingData.length === 0) return 300;
  const scenarios = new Map<string, TimingEntry[]>();
  for (const entry of timingData) {
    if (!scenarios.has(entry.scenario)) scenarios.set(entry.scenario, []);
    scenarios.get(entry.scenario)!.push(entry);
  }
  let totalFrames = BROLL_SHOT1 + INTRO_FRAMES;
  for (const [scenarioId, entries] of scenarios) {
    totalFrames += TITLE_CARD_FRAMES;
    const lastEntry = entries[entries.length - 1];
    const scenarioDurationMs =
      lastEntry.timestamp_ms + lastEntry.wait_duration_ms + (lastEntry.dwell_ms || 0) + 500;
    const rate = scenarioId === "chat" ? 1.8 : 1.0;
    totalFrames += Math.ceil((scenarioDurationMs / rate / 1000) * FPS);
    if (scenarioId === "display-case") totalFrames += BROLL_SHOT7B;
  }
  totalFrames += BROLL_SHOT9 + OUTRO_FRAMES;
  return Math.max(totalFrames, 1);
}

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="TestVideo"
      component={TestVideo}
      fps={FPS}
      width={1440}
      height={900}
      defaultProps={{
        timingData: defaultTiming as TimingEntry[],
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: computeTotalFrames(props.timingData),
      })}
    />
  );
};
