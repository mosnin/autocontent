// Story video step mapping and media URLs (components/app/stories/types.ts). Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { STORY_BUSY, storyMedia, storyStep, storyTone, type StoryStatus } from "../components/app/stories/types.ts";

test("every status lands on one of the four steps", () => {
  const cases: Array<[StoryStatus, string, number]> = [
    ["writing", "script", 0],
    ["script_ready", "", 0],
    ["boarding", "storyboard", 1],
    ["storyboard_ready", "", 1],
    ["awaiting_approval", "", 2],
    ["rendering", "render", 2],
    ["done", "", 3],
    ["failed", "script", 0],
    ["failed", "revise", 0],
    ["failed", "storyboard", 1],
    ["failed", "frame:3", 1],
    ["failed", "render", 2],
  ];
  for (const [status, stage, step] of cases) assert.equal(storyStep({ status, stage }), step, `${status}/${stage}`);
});

test("only background stages refresh, and tones carry meaning", () => {
  assert.deepEqual([...STORY_BUSY].sort(), ["boarding", "rendering", "writing"]);
  assert.equal(storyTone("awaiting_approval"), "attention");
  assert.equal(storyTone("failed"), "negative");
  assert.equal(storyTone("done"), "positive");
  assert.equal(storyTone("script_ready"), "neutral");
});

test("media urls go through the proxy and bust the cache on a redraw", () => {
  const shot = { idx: 2, frame_rev: 3 } as Parameters<typeof storyMedia.frame>[1];
  assert.equal(storyMedia.frame("a/b", shot), "/api/proxy/api/v1/stories/a%2Fb/shots/2/frame?v=3");
  assert.equal(storyMedia.video("s1", 4), "/api/proxy/api/v1/stories/s1/video?r=4");
});
