import React from "react";
import { Composition, staticFile } from "remotion";
import { TestVideo } from "./TestVideo";
import type { TimingEntry } from "./types";
import defaultTiming from "../public/timing-data.json";

const FPS = 30;
const TITLE_CARD_FRAMES = 45; // 1.5s
const INTRO_FRAMES = 90;  // 3s brand intro
const OUTRO_FRAMES = 90;  // 3s brand outro

function computeTotalFrames(timingData: TimingEntry[]): number {
  if (timingData.length === 0) return 300;
  const scenarios = new Map<string, TimingEntry[]>();
  for (const entry of timingData) {
    if (!scenarios.has(entry.scenario)) scenarios.set(entry.scenario, []);
    scenarios.get(entry.scenario)!.push(entry);
  }
  let totalFrames = INTRO_FRAMES;
  for (const [, entries] of scenarios) {
    totalFrames += TITLE_CARD_FRAMES;
    const lastEntry = entries[entries.length - 1];
    const scenarioDurationMs =
      lastEntry.timestamp_ms + lastEntry.wait_duration_ms + (lastEntry.dwell_ms || 0) + 500;
    totalFrames += Math.ceil((scenarioDurationMs / 1000) * FPS);
  }
  totalFrames += OUTRO_FRAMES;
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
