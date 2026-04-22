import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

interface CaptionProps {
  text: string;
  startFrame: number;
  durationFrames: number;
}

export const Caption: React.FC<CaptionProps> = ({
  text,
  startFrame,
  durationFrames,
}) => {
  const frame = useCurrentFrame();
  const relativeFrame = frame - startFrame;

  if (relativeFrame < 0 || relativeFrame >= durationFrames) {
    return null;
  }

  const opacity = interpolate(
    relativeFrame,
    [0, 6, durationFrames - 6, durationFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        bottom: 80,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity,
      }}
    >
      <div
        style={{
          background: "linear-gradient(180deg, rgba(20,15,10,0.82) 0%, rgba(20,15,10,0.92) 100%)",
          color: "#fff8ee",
          padding: "14px 28px",
          borderRadius: 10,
          fontSize: 26,
          fontFamily: "Geist, Inter, system-ui, sans-serif",
          fontWeight: 500,
          maxWidth: "78%",
          textAlign: "center",
          lineHeight: 1.35,
          borderLeft: "4px solid oklch(0.76 0.14 70)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        }}
      >
        {text}
      </div>
    </div>
  );
};
