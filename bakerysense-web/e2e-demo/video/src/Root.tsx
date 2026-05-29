import React from "react";
import { Composition } from "remotion";
import { HarnessStory, HARNESS_STORY_FRAMES, Cover } from "./HarnessStory";

const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HarnessStory"
        component={HarnessStory}
        fps={FPS}
        width={1440}
        height={900}
        durationInFrames={HARNESS_STORY_FRAMES}
      />
      <Composition
        id="Cover"
        component={Cover}
        fps={FPS}
        width={1920}
        height={1080}
        durationInFrames={1}
      />
    </>
  );
};
