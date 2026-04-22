import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  interpolate,
} from "remotion";
import { Caption } from "./Caption";
import type { TimingEntry } from "./types";

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
  "signout": { title: "Session close", subtitle: "JWT + refresh + JWKS rotation" },
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

interface TestVideoProps { timingData: TimingEntry[] }

export const TestVideo: React.FC<TestVideoProps> = ({ timingData }) => {
  const scenarios = new Map<string, TimingEntry[]>();
  for (const entry of timingData) {
    if (!scenarios.has(entry.scenario)) scenarios.set(entry.scenario, []);
    scenarios.get(entry.scenario)!.push(entry);
  }

  let currentFrame = 0;
  const sequences: React.ReactNode[] = [];

  // Cold-open B-roll (owner on cam)
  sequences.push(
    <Sequence key="broll-1" from={currentFrame} durationInFrames={BROLL_SHOT1}>
      <BRollShot
        src="shot1-cold-open.mp4"
        durationFrames={BROLL_SHOT1}
        caption="Yesterday I threw out 40 croissants. I needed something that would just tell me how many to bake."
        attribution="Generated · alibaba/wan-2.6"
      />
    </Sequence>
  );
  currentFrame += BROLL_SHOT1;

  sequences.push(
    <Sequence key="intro" from={currentFrame} durationInFrames={INTRO_FRAMES}>
      <IntroCard />
    </Sequence>
  );
  currentFrame += INTRO_FRAMES;

  const scenarioIds = Array.from(scenarios.keys());
  for (const [scenarioId, entries] of scenarios) {
    sequences.push(
      <Sequence key={`title-${scenarioId}`} from={currentFrame} durationInFrames={TITLE_CARD_FRAMES}>
        <TitleCard id={scenarioId} />
      </Sequence>
    );
    currentFrame += TITLE_CARD_FRAMES;

    const lastEntry = entries[entries.length - 1];
    const scenarioDurationMs =
      lastEntry.timestamp_ms + lastEntry.wait_duration_ms + (lastEntry.dwell_ms || 0) + 500;
    const scenarioDurationFrames = Math.ceil((scenarioDurationMs / 1000) * FPS);

    sequences.push(
      <Sequence key={`video-${scenarioId}`} from={currentFrame} durationInFrames={scenarioDurationFrames}>
        <AbsoluteFill style={{ backgroundColor: "#000" }}>
          <OffthreadVideo
            src={staticFile(`recordings/${lastEntry.video_file}`)}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
          {entries.map((entry, i) => {
            const captionStartFrame = Math.floor((entry.timestamp_ms / 1000) * FPS);
            const nextStart = i + 1 < entries.length
              ? Math.floor((entries[i + 1].timestamp_ms / 1000) * FPS)
              : scenarioDurationFrames;
            const durationFrames = Math.max(nextStart - captionStartFrame, FPS * 2);
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
      </Sequence>
    );
    currentFrame += scenarioDurationFrames;

    // Cutaway B-roll right after the display-case screen scenario.
    if (scenarioId === "display-case") {
      sequences.push(
        <Sequence key="broll-7b" from={currentFrame} durationInFrames={BROLL_SHOT7B}>
          <BRollShot
            src="shot7b-display-case.mp4"
            durationFrames={BROLL_SHOT7B}
            caption="At 5pm I take one photo. It counts what's left."
            attribution="Generated · alibaba/wan-2.6"
          />
        </Sequence>
      );
      currentFrame += BROLL_SHOT7B;
    }
  }

  // Closing B-roll before outro card
  sequences.push(
    <Sequence key="broll-9" from={currentFrame} durationInFrames={BROLL_SHOT9}>
      <BRollShot
        src="shot9-close.mp4"
        durationFrames={BROLL_SHOT9}
        caption="By month two, the model knows my bakery better than I do."
        attribution="Generated · alibaba/wan-2.6"
      />
    </Sequence>
  );
  currentFrame += BROLL_SHOT9;

  sequences.push(
    <Sequence key="outro" from={currentFrame} durationInFrames={OUTRO_FRAMES}>
      <OutroCard />
    </Sequence>
  );

  return <AbsoluteFill>{sequences}</AbsoluteFill>;
};
