import React from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  interpolate,
} from "remotion";
import { Caption } from "./Caption";
import type { TimingEntry } from "./types";
import voiceoverManifest from "../public/voiceover/manifest.json";

interface VoiceoverEntry {
  id: string;
  voice: string;
  speaker: "owner" | "vo";
  scenario_anchor: string;
  text: string;
  audio_file: string;
  duration_ms: number;
  byte_size: number;
}

// Index voiceover sections by their anchor for O(1) lookup while building
// the sequence list. Empty manifest → no <Audio> emitted, video stays silent.
const voiceoverByAnchor: Map<string, VoiceoverEntry> = new Map(
  (voiceoverManifest as VoiceoverEntry[]).map((entry) => [entry.scenario_anchor, entry]),
);

const VO_TAIL_MS = 500;

export function audioDurationFrames(anchor: string, fps: number = 30): number {
  const entry = voiceoverByAnchor.get(anchor);
  if (!entry) return 0;
  return Math.ceil(((entry.duration_ms + VO_TAIL_MS) / 1000) * fps);
}

export function audioPaddedFrames(anchor: string, baseFrames: number, fps: number = 30): number {
  return Math.max(baseFrames, audioDurationFrames(anchor, fps));
}

function VoiceoverFor({ anchor }: { anchor: string }): React.ReactElement | null {
  const entry = voiceoverByAnchor.get(anchor);
  if (!entry) return null;
  return (
    <Audio
      src={staticFile(`voiceover/${entry.audio_file}`)}
      volume={entry.speaker === "owner" ? 1.0 : 0.95}
    />
  );
}

const FPS = 30;
const TITLE_CARD_FRAMES = 45;
const INTRO_FRAMES = 90;
const OUTRO_FRAMES = 90;

const SCENARIO_LABELS: Record<string, { title: string; subtitle: string }> = {
  "landing": { title: "Landing & sign in", subtitle: "One tenant, one bakery, one Gemma 4 agent" },
  "dashboard": { title: "Today's bake plan", subtitle: "LightGBM quantile forecasts per SKU, per branch" },
  "sku-detail": { title: "Quantile band + drivers", subtitle: "Newsvendor-picked quantity, SHAP-style explanation" },
  "chat": { title: "Ask Gemma 4", subtitle: "Multi-tool agent loop grounded in the forecaster" },
  "display-case": { title: "Display case", subtitle: "Multimodal photo → unit counts → markdowns" },
  "retraining": { title: "Feedback loop", subtitle: "Actuals → queue → retrain → hot swap" },
  "signout": { title: "Sign out", subtitle: "JWT + refresh-token tombstones + JWKS rotation" },
};

const BRAND_INK = "oklch(0.22 0 0)";
const BRAND_AMBER = "oklch(0.76 0.14 70)";
const BRAND_SURFACE = "oklch(0.99 0 0)";
const BRAND_MUTED = "oklch(0.50 0.01 0)";

const IntroCard: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10, 75, 90], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const scale = interpolate(frame, [0, 30], [0.98, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND_SURFACE,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div style={{ transform: `scale(${scale})`, textAlign: "center", fontFamily: "Geist, Inter, system-ui, sans-serif" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 10,
          padding: "6px 14px", marginBottom: 28,
          borderRadius: 999,
          background: "oklch(0.95 0.04 70)", color: "oklch(0.30 0.10 45)",
          fontSize: 16, fontWeight: 500,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: BRAND_AMBER }} />
          Gemma 4 Good Hackathon · Retail + Food Waste
        </div>
        <h1 style={{ fontSize: 80, fontWeight: 700, color: BRAND_INK, margin: 0, letterSpacing: "-0.02em" }}>
          BakerySense
        </h1>
        <p style={{ fontSize: 28, color: BRAND_MUTED, marginTop: 18, maxWidth: 760 }}>
          AI production copilot for retail chains.
        </p>
      </div>
    </AbsoluteFill>
  );
};

const TitleCard: React.FC<{ id: string }> = ({ id }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, 37, 45], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const label = SCENARIO_LABELS[id] ?? { title: id, subtitle: "" };
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND_INK,
        display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center",
        opacity,
        fontFamily: "Geist, Inter, system-ui, sans-serif",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 24,
        color: BRAND_AMBER, fontSize: 18, fontWeight: 500, letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}>
        <span style={{ width: 32, height: 2, background: BRAND_AMBER }} />
        {id.replace(/-/g, " · ")}
      </div>
      <h2 style={{ fontSize: 64, fontWeight: 700, color: "#fff8ee", margin: 0, letterSpacing: "-0.02em" }}>
        {label.title}
      </h2>
      {label.subtitle && (
        <p style={{ fontSize: 24, color: "oklch(0.70 0.02 80)", marginTop: 16, maxWidth: 900, textAlign: "center" }}>
          {label.subtitle}
        </p>
      )}
    </AbsoluteFill>
  );
};

const OutroCard: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15, 75, 90], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND_SURFACE,
        display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center",
        opacity,
        fontFamily: "Geist, Inter, system-ui, sans-serif",
      }}
    >
      <h2 style={{ fontSize: 56, fontWeight: 700, color: BRAND_INK, margin: 0, letterSpacing: "-0.02em" }}>
        Ship it.
      </h2>
      <p style={{ fontSize: 22, color: BRAND_MUTED, marginTop: 20, maxWidth: 780, textAlign: "center" }}>
        Gemma 4 · Cloudflare Workers · Offline-first · CC-BY-4.0
      </p>
      <p style={{ fontSize: 18, color: BRAND_MUTED, marginTop: 8, fontFamily: "Geist Mono, monospace" }}>
        bakerysense-web.swmengappdev.workers.dev
      </p>
    </AbsoluteFill>
  );
};

/** On-cam bakery B-roll clip with an owner-line caption. */
const BRollShot: React.FC<{ src: string; durationFrames: number; caption: string; attribution?: string }> = ({
  src, durationFrames, caption, attribution,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <OffthreadVideo src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <Caption text={caption} startFrame={12} durationFrames={durationFrames - 12} />
      {attribution && (
        <div style={{
          position: "absolute", top: 24, right: 32,
          color: "oklch(0.85 0 0)", fontSize: 13, fontFamily: "Geist Mono, monospace",
          background: "rgba(0,0,0,0.4)", padding: "4px 10px", borderRadius: 6,
          letterSpacing: "0.04em",
        }}>
          {attribution}
        </div>
      )}
    </AbsoluteFill>
  );
};

const BROLL_SHOT1 = Math.ceil(10 * FPS);    // 10 s
const BROLL_SHOT7B = Math.ceil(5 * FPS);    // 5 s
const BROLL_SHOT9 = Math.ceil(10 * FPS);    // 10 s

// Chat scenario time-remap: the Gemma round-trip takes ~54 s of wall-clock
// "thinking" time that we want to compress to 5 s without losing the tool-
// trace reveal or the final answer. We slice the source recording into three
// segments and give the middle one a ~10× playback rate. The speedup window
// is derived per-recording from the "submit-to-gemma" step's wait duration.
const CHAT_SPEEDUP_TARGET_S = 5;

interface ChatSegment {
  sourceStartMs: number;
  sourceEndMs: number;
  rate: number;
  compStartFrame: number;
  compDurationFrames: number;
}

function buildChatSegments(
  endMs: number,
  speedupStartMs: number,
  speedupEndMs: number,
): ChatSegment[] {
  const segs: ChatSegment[] = [];
  let cursor = 0;

  const segA: ChatSegment = {
    sourceStartMs: 0,
    sourceEndMs: speedupStartMs,
    rate: 1,
    compStartFrame: cursor,
    compDurationFrames: Math.ceil((speedupStartMs / 1000) * FPS),
  };
  cursor += segA.compDurationFrames;
  segs.push(segA);

  const speedupSrcMs = speedupEndMs - speedupStartMs;
  const segB: ChatSegment = {
    sourceStartMs: speedupStartMs,
    sourceEndMs: speedupEndMs,
    rate: speedupSrcMs / 1000 / CHAT_SPEEDUP_TARGET_S,
    compStartFrame: cursor,
    compDurationFrames: Math.ceil(CHAT_SPEEDUP_TARGET_S * FPS),
  };
  cursor += segB.compDurationFrames;
  segs.push(segB);

  if (endMs > speedupEndMs) {
    const segC: ChatSegment = {
      sourceStartMs: speedupEndMs,
      sourceEndMs: endMs,
      rate: 1,
      compStartFrame: cursor,
      compDurationFrames: Math.ceil(((endMs - speedupEndMs) / 1000) * FPS),
    };
    cursor += segC.compDurationFrames;
    segs.push(segC);
  }
  return segs;
}

/**
 * The speedup window is the span from "submit click" to "tool trace visible"
 * for the chat scenario. Expressed in scenario-local ms (post-initial-nav).
 */
function findChatSpeedupWindow(entries: TimingEntry[], scenarioStartSessionMs: number): [number, number] | null {
  // The step with the biggest wait_duration is the Gemma round-trip.
  let best: TimingEntry | null = null;
  for (const e of entries) {
    if (!best || e.wait_duration_ms > best.wait_duration_ms) best = e;
  }
  if (!best || best.wait_duration_ms < 10_000) return null;
  const startMs = best.session_ms - scenarioStartSessionMs;
  const endMs = best.session_ms + best.wait_duration_ms - scenarioStartSessionMs;
  return [Math.max(0, startMs), Math.max(startMs + 1000, endMs)];
}

function chatSourceMsToCompFrame(sourceMs: number, segs: ChatSegment[]): number {
  for (const s of segs) {
    if (sourceMs <= s.sourceEndMs) {
      const delta = Math.max(0, sourceMs - s.sourceStartMs);
      return s.compStartFrame + Math.floor((delta / 1000 / s.rate) * FPS);
    }
  }
  const last = segs[segs.length - 1];
  return last.compStartFrame + last.compDurationFrames;
}

export function computeChatTotalFrames(endMs: number, speedupStartMs: number, speedupEndMs: number): number {
  const segs = buildChatSegments(endMs, speedupStartMs, speedupEndMs);
  const last = segs[segs.length - 1];
  return last.compStartFrame + last.compDurationFrames;
}

interface TestVideoProps { timingData: TimingEntry[] }

export const TestVideo: React.FC<TestVideoProps> = ({ timingData }) => {
  const scenarios = new Map<string, TimingEntry[]>();
  for (const entry of timingData) {
    if (!scenarios.has(entry.scenario)) scenarios.set(entry.scenario, []);
    scenarios.get(entry.scenario)!.push(entry);
  }

  let currentFrame = 0;
  const sequences: React.ReactNode[] = [];

  // Cold-open B-roll (owner on cam). Pad to fit voiceover if it's longer.
  const broll1Frames = audioPaddedFrames("broll-shot1", BROLL_SHOT1, FPS);
  sequences.push(
    <Sequence key="broll-1" from={currentFrame} durationInFrames={broll1Frames}>
      <BRollShot
        src="shot1-cold-open.mp4"
        durationFrames={broll1Frames}
        caption="Independent bakeries throw out 30–40% of what they make."
        attribution="Generated · alibaba/wan-2.6"
      />
      <VoiceoverFor anchor="broll-shot1" />
    </Sequence>
  );
  currentFrame += broll1Frames;

  const introFrames = audioPaddedFrames("intro", INTRO_FRAMES, FPS);
  sequences.push(
    <Sequence key="intro" from={currentFrame} durationInFrames={introFrames}>
      <IntroCard />
      <VoiceoverFor anchor="intro" />
    </Sequence>
  );
  currentFrame += introFrames;

  for (const [scenarioId, entries] of scenarios) {
    sequences.push(
      <Sequence key={`title-${scenarioId}`} from={currentFrame} durationInFrames={TITLE_CARD_FRAMES}>
        <TitleCard id={scenarioId} />
      </Sequence>
    );
    currentFrame += TITLE_CARD_FRAMES;

    const firstEntry = entries[0];
    const lastEntry = entries[entries.length - 1];

    // Anchor the scenario at "after the initial navigate resolves" — this
    // skips the brief frame where the previous scenario's last page is still
    // visible, which otherwise makes sign-in flash back after the title card.
    const scenarioSourceStartMs = firstEntry.session_ms + firstEntry.wait_duration_ms;
    // Cap the trailing wait only when the last step is a click/submit that
    // triggers a page transition (e.g. "Submit sign-in" lands on the
    // dashboard) — otherwise we sit on the next scenario's page while
    // narrating this one. "wait" actions (chat's final-answer reveal) keep
    // their full wait duration.
    const lastIsWait = lastEntry.action === "wait";
    const TRAILING_WAIT_CAP_MS = 1500;
    const trailingWait = lastIsWait
      ? lastEntry.wait_duration_ms
      : Math.min(lastEntry.wait_duration_ms, TRAILING_WAIT_CAP_MS);
    const scenarioSourceEndMs =
      lastEntry.session_ms + trailingWait + (lastEntry.dwell_ms || 0) + 500;
    const scenarioDurationMs = scenarioSourceEndMs - scenarioSourceStartMs;

    // Caption fires when the action starts (e.g. the click), so it narrates
    // what's about to happen and remains visible through the post-action load.
    // For the first step we clamp to 0 because the scenario clip is anchored
    // at "after the initial navigate resolves".
    const captionLocalMs = (e: TimingEntry): number =>
      Math.max(0, e.session_ms - scenarioSourceStartMs);

    const MIN_GAP_MS = 500;
    const kept = entries.filter((e, i) => {
      const next = entries[i + 1];
      if (!next) return true;
      return captionLocalMs(next) - captionLocalMs(e) >= MIN_GAP_MS;
    });

    if (scenarioId === "chat") {
      const window = findChatSpeedupWindow(entries, scenarioSourceStartMs);
      if (!window) throw new Error("chat scenario has no long-wait step to compress");
      const [speedupStartMs, speedupEndMs] = window;
      const segments = buildChatSegments(scenarioDurationMs, speedupStartMs, speedupEndMs);
      const scenarioDurationFrames = segments[segments.length - 1].compStartFrame
        + segments[segments.length - 1].compDurationFrames;

      const captions = kept.map((entry, i) => {
        const captionStartFrame = chatSourceMsToCompFrame(captionLocalMs(entry), segments);
        const isLast = i + 1 >= kept.length;
        const nextStart = isLast
          ? scenarioDurationFrames
          : chatSourceMsToCompFrame(captionLocalMs(kept[i + 1]), segments);
        const raw = Math.max(nextStart - captionStartFrame, 20);
        const durationFrames = isLast ? Math.max(raw, FPS * 2) : raw;
        return (
          <Caption
            key={`caption-${entry.scenario}-${entry.step}`}
            text={entry.description}
            startFrame={captionStartFrame}
            durationFrames={durationFrames}
          />
        );
      });

      sequences.push(
        <Sequence key={`video-${scenarioId}`} from={currentFrame} durationInFrames={scenarioDurationFrames}>
          <AbsoluteFill style={{ backgroundColor: "#000" }}>
            {segments.map((seg, idx) => {
              const sourceStartSec = (scenarioSourceStartMs + seg.sourceStartMs) / 1000;
              return (
                <Sequence
                  key={`chat-seg-${idx}`}
                  from={seg.compStartFrame}
                  durationInFrames={seg.compDurationFrames}
                >
                  <OffthreadVideo
                    src={staticFile(`recordings/${lastEntry.video_file}`)}
                    startFrom={Math.floor(sourceStartSec * FPS)}
                    playbackRate={seg.rate}
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                  {seg.rate > 1.01 && (
                    <div style={{
                      position: "absolute", top: 20, left: 20,
                      background: "rgba(20,15,10,0.75)", color: "oklch(0.95 0.04 70)",
                      padding: "4px 10px", borderRadius: 6,
                      fontFamily: "Geist Mono, monospace", fontSize: 13,
                      letterSpacing: "0.04em",
                    }}>
                      {seg.rate.toFixed(1)}× · Gemma 4 round-trip
                    </div>
                  )}
                </Sequence>
              );
            })}
            {captions}
          </AbsoluteFill>
          <VoiceoverFor anchor={scenarioId} />
        </Sequence>
      );
      currentFrame += scenarioDurationFrames;
    } else {
      const baseFrames = Math.ceil((scenarioDurationMs / 1000) * FPS);
      const scenarioDurationFrames = audioPaddedFrames(scenarioId, baseFrames, FPS);
      sequences.push(
        <Sequence key={`video-${scenarioId}`} from={currentFrame} durationInFrames={scenarioDurationFrames}>
          <AbsoluteFill style={{ backgroundColor: "#000" }}>
            <OffthreadVideo
              src={staticFile(`recordings/${lastEntry.video_file}`)}
              startFrom={Math.floor((scenarioSourceStartMs / 1000) * FPS)}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
            {kept.map((entry, i) => {
              const captionStartFrame = Math.floor((captionLocalMs(entry) / 1000) * FPS);
              const isLast = i + 1 >= kept.length;
              const nextStart = isLast
                ? scenarioDurationFrames
                : Math.floor((captionLocalMs(kept[i + 1]) / 1000) * FPS);
              const raw = Math.max(nextStart - captionStartFrame, 20);
              const durationFrames = isLast ? Math.max(raw, FPS * 2) : raw;
              return (
                <Caption
                  key={`caption-${entry.scenario}-${entry.step}`}
                  text={entry.description}
                  startFrame={captionStartFrame}
                  durationFrames={durationFrames}
                />
              );
            })}
          </AbsoluteFill>
          <VoiceoverFor anchor={scenarioId} />
        </Sequence>
      );
      currentFrame += scenarioDurationFrames;
    }

    // Cutaway B-roll right after the display-case screen scenario.
    if (scenarioId === "display-case") {
      const broll7bFrames = audioPaddedFrames("broll-shot7b", BROLL_SHOT7B, FPS);
      sequences.push(
        <Sequence key="broll-7b" from={currentFrame} durationInFrames={broll7bFrames}>
          <BRollShot
            src="shot7b-display-case.mp4"
            durationFrames={broll7bFrames}
            caption="One photo. Gemma 4 counts what's left."
            attribution="Generated · alibaba/wan-2.6"
          />
          <VoiceoverFor anchor="broll-shot7b" />
        </Sequence>
      );
      currentFrame += broll7bFrames;
    }
  }

  // Closing B-roll before outro card
  const broll9Frames = audioPaddedFrames("broll-shot9", BROLL_SHOT9, FPS);
  sequences.push(
    <Sequence key="broll-9" from={currentFrame} durationInFrames={broll9Frames}>
      <BRollShot
        src="shot9-close.mp4"
        durationFrames={broll9Frames}
        caption="Within two months, it learns the bakery better than the baker."
        attribution="Generated · alibaba/wan-2.6"
      />
      <VoiceoverFor anchor="broll-shot9" />
    </Sequence>
  );
  currentFrame += broll9Frames;

  sequences.push(
    <Sequence key="outro" from={currentFrame} durationInFrames={OUTRO_FRAMES}>
      <OutroCard />
    </Sequence>
  );

  return <AbsoluteFill>{sequences}</AbsoluteFill>;
};
