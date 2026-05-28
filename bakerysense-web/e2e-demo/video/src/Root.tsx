import React from "react";
import { Composition } from "remotion";
import { HarnessStory, HARNESS_STORY_FRAMES } from "./HarnessStory";

const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="HarnessStory"
      component={HarnessStory}
      fps={FPS}
      width={1440}
      height={900}
      durationInFrames={HARNESS_STORY_FRAMES}
    />
  );
};
