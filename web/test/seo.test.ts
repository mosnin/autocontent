// Tests for the SEO article helpers (lib/seo.ts): metadata rules that mirror
// the backend, keyword parsing for bulk generation, calendar day moves and
// publish labels. Run with `npm test`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { httpsOnly, moveToDay, parseKeywords, publishLabel, slugify, validateMeta } from "../lib/seo.ts";

const good = { meta_title: "Cold Brew Guide", meta_description: "Make it.", slug: "cold-brew", focus_keyword: "cold brew", secondary_keywords: ["iced coffee"] };

test("valid metadata has no problems", () => {
  assert.deepEqual(validateMeta(good), {});
  assert.deepEqual(validateMeta({ ...good, meta_title: "x".repeat(60), meta_description: "y".repeat(155) }), {});
});

test("metadata limits match the backend", () => {
  assert.ok(validateMeta({ ...good, meta_title: "x".repeat(61) }).meta_title);
  assert.ok(validateMeta({ ...good, meta_description: "y".repeat(156) }).meta_description);
  assert.ok(validateMeta({ ...good, slug: "Cold Brew" }).slug);
  assert.ok(validateMeta({ ...good, slug: "cold--brew" }).slug);
  assert.ok(validateMeta({ ...good, focus_keyword: " " }).focus_keyword);
  assert.ok(validateMeta({ ...good, secondary_keywords: ["Cold Brew"] }).secondary_keywords);
  assert.ok(validateMeta({ ...good, secondary_keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) }).secondary_keywords);
});

test("slugify", () => {
  assert.equal(slugify("Café crème: à la maison!"), "cafe-creme-a-la-maison");
  assert.equal(slugify("x".repeat(100)).length, 80);
});

test("parseKeywords trims, dedupes case-insensitively and keeps order", () => {
  assert.deepEqual(parseKeywords("cold brew\n\n Cold Brew \r\niced latte\n"), ["cold brew", "iced latte"]);
});

test("moveToDay keeps the local time of day", () => {
  const src = new Date(2026, 10, 3, 9, 30);
  const out = moveToDay(src.toISOString(), "2026-11-05");
  assert.equal(out.getDate(), 5);
  assert.equal(out.getHours(), 9);
  assert.equal(out.getMinutes(), 30);
});

test("publish labels", () => {
  assert.equal(publishLabel({ publish_status: "none" }), null);
  assert.equal(publishLabel({ publish_status: "published", published_at: null })?.label, "Draft on WordPress");
  assert.equal(publishLabel({ publish_status: "published", published_at: "2026-01-01T00:00:00Z" })?.label, "Live on WordPress");
  assert.equal(publishLabel({ publish_status: "unknown" })?.tone, "attention");
});

test("only https links are clickable", () => {
  assert.equal(httpsOnly("javascript:alert(1)"), null);
  assert.equal(httpsOnly("http://a.test"), null);
  assert.equal(httpsOnly("https://a.test"), "https://a.test");
});
