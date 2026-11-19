// Tests for the pure security helpers in lib/security. Run with `npm test`
// (Node's built-in runner; no extra dependency).

import assert from "node:assert/strict";
import { test } from "node:test";

import { agentTokenTtl, mintAgentToken, timingSafeEqual, verifyAgentToken } from "../lib/security/agent-token.ts";
import { BodyTooLargeError, readBodyCapped, readJsonCapped } from "../lib/security/body.ts";
import { appCspDirectives, cspReportOnly } from "../lib/security/csp.ts";
import { downstreamResponseHeaders, isSameOriginRequest, resolveUpstream, upstreamRequestHeaders } from "../lib/security/proxy-policy.ts";
import { createRateLimiter } from "../lib/security/rate-limit.ts";
import { idSegment, previewEnabled, publicApiError, safeExternalUrl, safeReturnPath } from "../lib/security/urls.ts";

const BASE = "https://api.example.test";
const headers = (h: Record<string, string>) => new Headers(h);

// ── proxy: destination ──────────────────────────────────────────────────────

test("proxy forwards an allowlisted path to the configured origin", () => {
  assert.deepEqual(resolveUpstream(BASE, ["api", "v1", "niches"], "?limit=5"), { ok: true, url: `${BASE}/api/v1/niches?limit=5` });
  assert.deepEqual(resolveUpstream(`${BASE}/`, ["api", "v1", "jobs", "42"]), { ok: true, url: `${BASE}/api/v1/jobs/42` });
  // A base with a path keeps it.
  assert.deepEqual(resolveUpstream(`${BASE}/backend/`, ["api", "v1", "x"]), { ok: true, url: `${BASE}/backend/api/v1/x` });
});

test("proxy refuses paths outside the allowlist", () => {
  for (const path of [["docs"], ["openapi.json"], ["api", "v2", "x"], ["api"], ["internal", "metrics"], ["api", "v10", "x"], []]) {
    const r = resolveUpstream(BASE, path);
    assert.equal(r.ok, false, path.join("/"));
    if (!r.ok) assert.equal(r.status, 404);
  }
});

test("proxy refuses traversal and separator tricks", () => {
  for (const path of [
    ["api", "v1", "..", "..", "docs"],
    ["api", "v1", "."],
    ["api", "v1", "a/b"],
    ["api", "v1", "a\\b"],
    ["api", "v1", ""],
    ["api", "v1", "a\nb"],
    ["..", "api", "v1", "x"],
  ]) {
    assert.equal(resolveUpstream(BASE, path).ok, false, JSON.stringify(path));
  }
});

test("no path segment or query can choose the host", () => {
  for (const path of [
    ["api", "v1", "@evil.test"],
    ["api", "v1", "//evil.test"],
    ["api", "v1", "https:", "evil.test"],
    ["api", "v1", "x?y=https://evil.test"],
    ["api", "v1", "x#frag"],
    ["api", "v1", "%2e%2e", "%2e%2e", "docs"],
  ]) {
    const r = resolveUpstream(BASE, path, "?next=https://evil.test");
    if (r.ok) {
      const u = new URL(r.url);
      assert.equal(u.origin, BASE, JSON.stringify(path));
      assert.ok(u.pathname.startsWith("/api/v1/"), u.pathname);
    }
  }
  // Encoded, not interpreted: the query delimiter in a segment stays in the path.
  const r = resolveUpstream(BASE, ["api", "v1", "x?admin=1"]);
  assert.ok(r.ok && new URL(r.url).search === "");
});

test("proxy fails closed when the backend origin is missing or unsafe", () => {
  for (const base of [undefined, "", "not a url", "ftp://api.example.test", "javascript:alert(1)", "https://user:pw@api.example.test"]) {
    const r = resolveUpstream(base, ["api", "v1", "x"]);
    assert.equal(r.ok, false, String(base));
    if (!r.ok) assert.equal(r.status, 503);
  }
  // Plain http: fine for a local backend, refused for a remote one in production.
  assert.equal(resolveUpstream("http://localhost:8000", ["api", "v1", "x"], "", { production: true }).ok, true);
  assert.equal(resolveUpstream("http://api.example.test", ["api", "v1", "x"], "", { production: true }).ok, false);
  assert.equal(resolveUpstream("http://api.example.test", ["api", "v1", "x"], "", { production: false }).ok, true);
});

// ── proxy: headers ──────────────────────────────────────────────────────────

test("only allowlisted request headers reach the backend, with the server's token", () => {
  const out = upstreamRequestHeaders(
    headers({
      "content-type": "application/json",
      range: "bytes=0-99",
      cookie: "__session=secret",
      authorization: "Bearer attacker",
      host: "evil.test",
      "x-forwarded-host": "evil.test",
      "x-forwarded-for": "1.2.3.4",
      "x-user-id": "someone-else",
    }),
    "server-token",
  );
  assert.deepEqual(out, { "content-type": "application/json", range: "bytes=0-99", authorization: "Bearer server-token" });
});

test("hop-by-hop and sensitive response headers are stripped", () => {
  const out = downstreamResponseHeaders([
    ["content-type", "application/json"],
    ["set-cookie", "sid=1"],
    ["transfer-encoding", "chunked"],
    ["connection", "keep-alive"],
    ["keep-alive", "timeout=5"],
    ["access-control-allow-origin", "*"],
    ["access-control-allow-credentials", "true"],
    ["server", "uvicorn"],
    ["x-powered-by", "x"],
    ["strict-transport-security", "max-age=0"],
    ["location", "https://storage.example.test/signed"],
    ["content-range", "bytes 0-99/200"],
    ["etag", "abc"],
  ]);
  for (const gone of ["set-cookie", "transfer-encoding", "connection", "keep-alive", "access-control-allow-origin", "access-control-allow-credentials", "server", "x-powered-by", "strict-transport-security"]) {
    assert.equal(out.has(gone), false, gone);
  }
  assert.equal(out.get("location"), "https://storage.example.test/signed");
  assert.equal(out.get("content-range"), "bytes 0-99/200");
  assert.equal(out.get("etag"), "abc");
  assert.equal(out.get("x-content-type-options"), "nosniff");
  assert.equal(out.get("cache-control"), "private, no-store");
  assert.equal(out.has("content-security-policy"), false);
});

test("an HTML or SVG response from the backend is sandboxed; decoded bodies lose their length", () => {
  for (const type of ["text/html; charset=utf-8", "image/svg+xml", "application/xhtml+xml"]) {
    assert.equal(downstreamResponseHeaders([["content-type", type]]).get("content-security-policy"), "default-src 'none'; sandbox", type);
  }
  const out = downstreamResponseHeaders([["content-type", "application/json"], ["content-encoding", "gzip"], ["content-length", "120"], ["cache-control", "max-age=60"]]);
  assert.equal(out.has("content-encoding"), false);
  assert.equal(out.has("content-length"), false);
  assert.equal(out.get("cache-control"), "max-age=60");
  // An upstream CSP never replaces ours.
  assert.equal(downstreamResponseHeaders([["content-type", "video/mp4"], ["content-security-policy", "default-src *"]]).has("content-security-policy"), false);
});

// ── CSRF ────────────────────────────────────────────────────────────────────

test("reads are allowed from anywhere; mutations must be same-origin", () => {
  assert.equal(isSameOriginRequest("GET", headers({})), true);
  assert.equal(isSameOriginRequest("HEAD", headers({ origin: "https://evil.test", host: "app.test" })), true);
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(isSameOriginRequest(m, headers({ origin: "https://app.test", host: "app.test" })), true, m);
    assert.equal(isSameOriginRequest(m, headers({ origin: "https://evil.test", host: "app.test" })), false, m);
    assert.equal(isSameOriginRequest(m, headers({ origin: "https://app.test.evil.test", host: "app.test" })), false, m);
    assert.equal(isSameOriginRequest(m, headers({ origin: "null", host: "app.test" })), false, m);
    // Neither Origin nor Sec-Fetch-Site: refuse.
    assert.equal(isSameOriginRequest(m, headers({ host: "app.test" })), false, m);
    assert.equal(isSameOriginRequest(m, headers({ host: "app.test", "sec-fetch-site": "same-origin" })), true, m);
    assert.equal(isSameOriginRequest(m, headers({ host: "app.test", "sec-fetch-site": "same-site" })), false, m);
    assert.equal(isSameOriginRequest(m, headers({ host: "app.test", "sec-fetch-site": "cross-site" })), false, m);
  }
  // Behind a reverse proxy the public host is X-Forwarded-Host.
  assert.equal(isSameOriginRequest("POST", headers({ origin: "https://app.test", host: "10.0.0.5:3000", "x-forwarded-host": "app.test" })), true);
  assert.equal(isSameOriginRequest("POST", headers({ origin: "http://localhost:3100", host: "localhost:3100" })), true);
  assert.equal(isSameOriginRequest("POST", headers({ origin: "http://localhost:3999", host: "localhost:3100" })), false);
});

// ── body cap ────────────────────────────────────────────────────────────────

const req = (body: string | null, h: Record<string, string> = {}) => new Request("http://app.test/x", { method: "POST", body, headers: h });

test("bodies are read up to the cap and refused past it", async () => {
  assert.equal((await readBodyCapped(req("hello"), 5)).byteLength, 5);
  assert.equal((await readBodyCapped(req(null), 5)).byteLength, 0);
  await assert.rejects(readBodyCapped(req("hello!"), 5), BodyTooLargeError);
  // A declared length over the cap is refused before reading.
  await assert.rejects(readBodyCapped({ headers: headers({ "content-length": "999" }), body: null }, 5), BodyTooLargeError);
  // A stream that lies about (or omits) its length is still cut off.
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(new Uint8Array(4));
    },
  });
  await assert.rejects(readBodyCapped({ headers: headers({ "content-length": "1" }), body: stream }, 10), BodyTooLargeError);
});

test("capped JSON: parsed, or undefined when it is not JSON", async () => {
  assert.deepEqual(await readJsonCapped(req('{"a":1}'), 100), { a: 1 });
  assert.equal(await readJsonCapped(req("nope"), 100), undefined);
  await assert.rejects(readJsonCapped(req('{"a":"' + "x".repeat(200) + '"}'), 100), BodyTooLargeError);
});

// ── agent session token ─────────────────────────────────────────────────────

const SECRET = "test-signing-secret-0123456789";

const SUBJECT = { sub: "person_abc", tid: "tenant_xyz", roles: ["analyst"], scopes: ["analytics:read", "agent:chat"] };

test("a minted token verifies and carries the person, the tenant, the role and its scopes", async () => {
  const t0 = 1_700_000_000_000;
  const { token, expiresAt } = await mintAgentToken(SECRET, SUBJECT, { now: () => t0 });
  assert.equal(expiresAt, t0 + 900_000);
  const claims = await verifyAgentToken(SECRET, token, { now: () => t0 + 1000 });
  assert.ok(claims);
  assert.equal(claims.sub, "person_abc");
  assert.equal(claims.tid, "tenant_xyz");
  assert.deepEqual(claims.roles, ["analyst"]);
  assert.deepEqual(claims.scopes, ["analytics:read", "agent:chat"]);
  assert.equal(claims.env, "development");
  assert.equal(claims.exp - claims.iat, 900);
  assert.equal((await mintAgentToken(SECRET, SUBJECT, { production: true, now: () => t0 })).token.split(".").length, 2);
});

test("expired, tampered and wrongly signed tokens are refused", async () => {
  const t0 = 1_700_000_000_000;
  const { token } = await mintAgentToken(SECRET, SUBJECT, { now: () => t0 });
  assert.equal(await verifyAgentToken(SECRET, token, { now: () => t0 + 901_000 }), null, "expired");
  assert.equal(await verifyAgentToken("another-signing-secret-000000", token, { now: () => t0 }), null, "wrong secret");
  const [body, sig] = token.split(".") as [string, string];
  const tamper = (patch: Record<string, unknown>) => Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), ...patch })).toString("base64url");
  assert.equal(await verifyAgentToken(SECRET, `${tamper({ tid: "tenant_victim" })}.${sig}`, { now: () => t0 }), null, "forged tenant");
  assert.equal(await verifyAgentToken(SECRET, `${tamper({ roles: ["owner"] })}.${sig}`, { now: () => t0 }), null, "forged role");
  assert.equal(await verifyAgentToken(SECRET, `${tamper({ scopes: ["spend:approve"] })}.${sig}`, { now: () => t0 }), null, "forged scopes");
  assert.equal(await verifyAgentToken(SECRET, `${body}.${sig.slice(0, -2)}`, { now: () => t0 }), null, "truncated signature");
  assert.equal(await verifyAgentToken(SECRET, `${body}.${sig}.x`, { now: () => t0 }), null, "extra part");
  assert.equal(await verifyAgentToken(SECRET, body, { now: () => t0 }), null, "unsigned");
  assert.equal(await verifyAgentToken("", token, { now: () => t0 }), null, "no secret");
});

test("minting refuses a missing or short secret and an incomplete subject", async () => {
  await assert.rejects(mintAgentToken("", SUBJECT));
  await assert.rejects(mintAgentToken("short", SUBJECT));
  await assert.rejects(mintAgentToken(SECRET, { ...SUBJECT, sub: "" }), "no person");
  await assert.rejects(mintAgentToken(SECRET, { ...SUBJECT, tid: "" }), "no tenant");
  await assert.rejects(mintAgentToken(SECRET, { ...SUBJECT, roles: [] }), "no role");
  await assert.rejects(mintAgentToken(SECRET, { ...SUBJECT, roles: ["owner", "admin"] }), "two roles");
  await assert.rejects(mintAgentToken(SECRET, { ...SUBJECT, scopes: ["not a scope"] }), "bad scope");
});

test("token lifetime is clamped to 1–60 minutes", async () => {
  assert.equal(agentTokenTtl(undefined), 900);
  assert.equal(agentTokenTtl("nonsense"), 900);
  assert.equal(agentTokenTtl("5"), 60);
  assert.equal(agentTokenTtl("600"), 600);
  assert.equal(agentTokenTtl("999999"), 3600);
  const { expiresAt } = await mintAgentToken(SECRET, SUBJECT, { ttlSeconds: 10 ** 9, now: () => 0 });
  assert.equal(expiresAt, 3_600_000);
});

test("timingSafeEqual compares whole strings", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), true);
  assert.equal(timingSafeEqual("", "a"), false);
});

// ── rate limit ──────────────────────────────────────────────────────────────

test("rate limiter allows the limit, refuses the next, and resets per window and per key", () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(rl.hit("a").ok, true);
  assert.equal(rl.hit("a").ok, true);
  const third = rl.hit("a");
  assert.equal(third.ok, false);
  assert.equal(third.retryAfterSeconds, 1);
  assert.equal(rl.hit("b").ok, true, "another user is unaffected");
  t = 1000;
  assert.equal(rl.hit("a").ok, true, "new window");
});

test("rate limiter memory is bounded", () => {
  const rl = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 3, now: () => 0 });
  for (const k of ["a", "b", "c", "d", "e"]) assert.equal(rl.hit(k).ok, true);
  // Still limiting the most recent keys.
  assert.equal(rl.hit("e").ok, false);
});

// ── URLs, ids, errors, preview flag ─────────────────────────────────────────

test("ids placed in backend paths cannot carry separators or dots", () => {
  assert.equal(idSegment("3f2b6c1e-9d0a-4c1b-8a55-0123456789ab"), "3f2b6c1e-9d0a-4c1b-8a55-0123456789ab");
  assert.equal(idSegment(" 42 "), "42");
  for (const bad of ["", "..", "../users/me", "a/b", "a?b=1", "a%2Fb", "a b", null, undefined, 42, "x".repeat(129)]) assert.equal(idSegment(bad), null, String(bad));
});

test("external redirects are https only", () => {
  assert.equal(safeExternalUrl("https://checkout.example.test/pay/cs_1"), "https://checkout.example.test/pay/cs_1");
  for (const bad of ["javascript:alert(1)", "data:text/html,<script>1</script>", "http://example.test/", "//example.test", "/home", "", "https://user:pw@example.test/", undefined, null]) {
    assert.equal(safeExternalUrl(bad), null, String(bad));
  }
});

test("return paths stay on this site", () => {
  assert.equal(safeReturnPath("/settings?tab=billing#x"), "/settings?tab=billing#x");
  for (const bad of ["//evil.test", "/\\evil.test", "https://evil.test", "javascript:alert(1)", "evil.test", "/a\\b", "/a\nb", "", undefined]) {
    assert.equal(safeReturnPath(bad), "/home", String(bad));
  }
  assert.equal(safeReturnPath("//evil.test", "/onboarding"), "/onboarding");
});

test("backend errors keep their status and lose their internals", () => {
  assert.equal(publicApiError(404, '{"detail":"Niche not found"}'), "404 Niche not found");
  assert.equal(publicApiError(422, '{"detail":[{"msg":"field required","loc":["body","title"]},{"msg":"too long"}]}'), "422 field required, too long");
  assert.equal(publicApiError(403, "<html>gateway</html>"), "403 Request failed");
  assert.equal(publicApiError(500, 'Traceback (most recent call last): File "/srv/app/db.py"'), "500 The service had a problem. Try again in a moment.");
  assert.equal(publicApiError(502, '{"detail":"postgres://user:pw@db/x refused"}'), "502 The service had a problem. Try again in a moment.");
  assert.ok(publicApiError(400, JSON.stringify({ detail: "x".repeat(5000) })).length <= 304);
});

test("the fixture preview is off in production unless explicitly enabled", () => {
  assert.equal(previewEnabled({ NODE_ENV: "production" }), false);
  assert.equal(previewEnabled({ NODE_ENV: "production", ENABLE_PREVIEW: "" }), false);
  assert.equal(previewEnabled({ NODE_ENV: "production", ENABLE_PREVIEW: "yes" }), false);
  assert.equal(previewEnabled({ NODE_ENV: "production", ENABLE_PREVIEW: "1" }), true);
  assert.equal(previewEnabled({ NODE_ENV: "development" }), true);
  assert.equal(previewEnabled({ NODE_ENV: "development", ENABLE_PREVIEW: "0" }), false);
  assert.equal(previewEnabled({}), true);
});

// ── CSP ─────────────────────────────────────────────────────────────────────

test("the app policy allows what the page-transition shader needs and nothing eval-like", () => {
  const d = appCspDirectives({ NEXT_PUBLIC_AGENT_ORIGIN: "https://agent.example.test/" });
  for (const src of ["'self'", "data:", "blob:"]) assert.ok(d["img-src"]!.includes(src), `img-src ${src}`);
  for (const src of ["'self'", "data:"]) assert.ok(d["font-src"]!.includes(src), `font-src ${src}`);
  assert.ok(d["connect-src"]!.includes("'self'"));
  assert.ok(d["connect-src"]!.includes("https://agent.example.test"));
  assert.ok(d["connect-src"]!.includes("wss://agent.example.test"));
  assert.deepEqual(d["frame-ancestors"], ["'none'"]);
  assert.deepEqual(d["object-src"], ["'none'"]);
  assert.deepEqual(d["base-uri"], ["'self'"]);
  assert.equal(JSON.stringify(d).includes("unsafe-eval"), false);
  assert.equal(JSON.stringify(d).includes("*"), false);
});

test("connect-src ignores junk and takes only explicit extra origins", () => {
  assert.deepEqual(appCspDirectives({ NEXT_PUBLIC_AGENT_ORIGIN: "javascript:alert(1)" })["connect-src"], ["'self'"]);
  assert.deepEqual(appCspDirectives({ CSP_CONNECT_SRC: "wss://ws-eu.pusher.com, https://sockjs-eu.pusher.com 'unsafe-inline' * http://plain.test" })["connect-src"], ["'self'", "wss://ws-eu.pusher.com", "https://sockjs-eu.pusher.com"]);
});

test("the policy is report-only until CSP_MODE=enforce", () => {
  assert.equal(cspReportOnly({}), true);
  assert.equal(cspReportOnly({ CSP_MODE: "report-only" }), true);
  assert.equal(cspReportOnly({ CSP_MODE: "enforce" }), false);
});
