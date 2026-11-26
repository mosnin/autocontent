// The short-video create flow's pure helpers (lib/short-video.ts). Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { changedFromDefaults, credits, DEFAULT_SETTINGS, EMPTY_DRAFT, ideaProblem, itemProgress, needsApproval, patch, STAGES, summary, toRequest, usdFromMicros } from "../lib/short-video.ts";

test("the idea step needs a topic or a five-word script", () => {
  assert.equal(ideaProblem({ source: "topic", topic: "ab", script: "" }), "Write a topic, a few words is enough.");
  assert.equal(ideaProblem({ source: "topic", topic: "coffee", script: "" }), null);
  assert.ok(ideaProblem({ source: "script", topic: "", script: "too short here" }));
  assert.equal(ideaProblem({ source: "script", topic: "", script: "one two three four five" }), null);
});

test("defaults make a complete request in one press", () => {
  const body = toRequest({ ...EMPTY_DRAFT, topic: "  coffee myths " });
  assert.deepEqual(body, { source: "topic", topic: "coffee myths", script: "", variants: 1, settings: DEFAULT_SETTINGS });
  assert.equal(toRequest({ ...EMPTY_DRAFT, topic: "x", variants: 40 }).variants, 10);
  assert.equal((toRequest({ ...EMPTY_DRAFT, topic: "x" }, "niche-1") as { niche_id?: string }).niche_id, "niche-1");
  // A topic draft never sends a stale script.
  assert.equal(toRequest({ ...EMPTY_DRAFT, topic: "x", script: "left over" }).script, "");
});

test("patch is immutable and fine-tune lists only what changed", () => {
  const next = patch(DEFAULT_SETTINGS, "footage", { speed: 1.5, transition: "none" });
  assert.equal(DEFAULT_SETTINGS.footage.speed, 1);
  assert.deepEqual(changedFromDefaults(DEFAULT_SETTINGS), []);
  assert.deepEqual(changedFromDefaults(next), ["1.5× speed", "hard cuts"]);
  assert.deepEqual(changedFromDefaults(patch(DEFAULT_SETTINGS, "music", { duck: false, volume_db: -24 })), ["music -24 dB", "no ducking"]);
});

test("summary reads like a sentence", () => {
  assert.equal(summary({ ...EMPTY_DRAFT, topic: "x" }), "1 video · 9:16 · about 30s · stock footage · highlighted subtitles · library music");
  const s = patch(patch(DEFAULT_SETTINGS, "footage", { sources: ["uploads"] }), "music", { mode: "none" });
  assert.match(summary({ ...EMPTY_DRAFT, variants: 5, settings: s }), /^5 variants .* your uploads .* no music$/);
});

test("approval threshold matches the backend", () => {
  assert.equal(needsApproval(3, 1), false);
  assert.equal(needsApproval(4, 1), true);
  assert.equal(needsApproval(1, 5.01), true);
});

test("progress per variant", () => {
  assert.deepEqual(itemProgress({ status: "done", stage: "done", stages: {} }), { current: STAGES.length, complete: true, failed: false });
  assert.deepEqual(itemProgress({ status: "running", stage: "footage", stages: {} }), { current: 3, complete: false, failed: false });
  assert.deepEqual(itemProgress({ status: "failed", stage: "render", stages: { footage: { state: "failed" } } }), { current: 3, complete: false, failed: true });
});

test("credits are unique and skip uploads; micros format as money", () => {
  const c = (creator: string, provider: "pexels" | "pixabay" | "upload") => ({ provider, provider_id: "1", kind: "video" as const, page_url: "", creator, creator_url: "", licence: "", licence_url: "", query: "" });
  assert.deepEqual(credits([c("Ana", "pexels"), c("Ana", "pexels"), c("kai", "pixabay"), c("", "upload")]), ["Ana on Pexels", "kai on Pixabay"]);
  assert.equal(usdFromMicros(183_600), "$0.18");
  assert.equal(usdFromMicros(900), "<$0.01");
  assert.equal(usdFromMicros(0), "$0.00");
});
