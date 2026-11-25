// SPDX-License-Identifier: GPL-3.0-or-later
import { Composition } from "remotion";
import { Demo, FPS, type Edl } from "./Demo";

const EMPTY: Edl = { title: "열린영수증 시연", items: [] };

/** 영상 길이는 편집 목록(build.mjs가 만든 edl.json)의 장면 길이를 더해 정한다. */
export const Root = () => (
  <Composition
    id="Demo"
    component={Demo}
    fps={FPS}
    width={1920}
    height={1080}
    durationInFrames={FPS * 10}
    defaultProps={EMPTY}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.max(FPS, props.items.reduce((n, it) => n + it.frames, 0)) })}
  />
);
