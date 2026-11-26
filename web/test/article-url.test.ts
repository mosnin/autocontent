// Tests for the article renderer's URL filter (components/app/seo/article-url.ts).
// Article markdown is model-written from web research: every target is untrusted.

import assert from "node:assert/strict";
import { test } from "node:test";

import { safeArticleUrl } from "../components/app/seo/article-url.ts";

test("http(s) links are allowed and marked external", () => {
  assert.deepEqual(safeArticleUrl("https://example.com/a?b=1#c"), { href: "https://example.com/a?b=1#c", external: true });
  assert.deepEqual(safeArticleUrl("http://example.com"), { href: "http://example.com/", external: true });
  assert.deepEqual(safeArticleUrl("  HTTPS://Example.com/x  "), { href: "https://example.com/x", external: true });
});

test("same-site relative links are allowed and stay in the tab", () => {
  assert.deepEqual(safeArticleUrl("/seo/a1"), { href: "/seo/a1", external: false });
  assert.deepEqual(safeArticleUrl("#how-to"), { href: "#how-to", external: false });
});

test("script and other schemes are refused, however they are spelled", () => {
  for (const bad of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD4=",
    "file:///etc/passwd",
    "blob:https://example.com/x",
    "mailto:a@b.c",
    "ftp://example.com/x",
    "intent://x#Intent;end",
  ])
    assert.equal(safeArticleUrl(bad), null, bad);
});

test("protocol-relative and host tricks are refused", () => {
  for (const bad of ["//evil.example", "//evil.example/path", "/\\evil.example", "\\\\evil.example", "https:\\\\evil.example", "https://user:pass@example.com/", "https://", "http:example.com"]) assert.equal(safeArticleUrl(bad), null, bad);
});

test("schemeless and path-relative targets are refused rather than guessed", () => {
  for (const bad of ["example.com", "www.example.com/x", "./x", "../x", "x", "?q=1"]) assert.equal(safeArticleUrl(bad), null, bad);
});

test("junk is refused and never throws", () => {
  for (const bad of ["", "   ", null, undefined, 3, {}, [], "https://example.com/" + "a".repeat(5000)]) assert.equal(safeArticleUrl(bad), null);
});

test("images: http(s), same-site paths and inline raster data only", () => {
  assert.equal(safeArticleUrl("https://cdn.example.com/a.png", "image")?.external, true);
  assert.deepEqual(safeArticleUrl("/api/media/file/hero", "image"), { href: "/api/media/file/hero", external: false });
  for (const type of ["png", "jpeg", "webp", "gif"]) assert.ok(safeArticleUrl(`data:image/${type};base64,iVBORw0KGgo=`, "image"), type);
});

test("images: svg, non-base64 and non-image data are refused; data is never a link", () => {
  for (const bad of [
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "data:image/png,rawbytes",
    "data:image/png;base64,abc<script>",
    "data:text/html;base64,PHNjcmlwdD4=",
    "javascript:alert(1)",
    "//evil.example/a.png",
  ])
    assert.equal(safeArticleUrl(bad, "image"), null, bad);
  assert.equal(safeArticleUrl("data:image/png;base64,iVBORw0KGgo=", "link"), null);
});
