// Thumbs on agent replies (lib/agent/feedback.ts): which messages get them,
// the body and URL the agent expects, and how failures read. Run with `npm test`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { FEEDBACK_COMMENT_MAX, FeedbackError, feedbackBody, feedbackError, feedbackUrl, isTraceSpanId, sendFeedback, traceSpanIdOf } from "../lib/agent/feedback.ts";

const SPAN = "4f2a9c1e7b3d5a60";

test("only replies with a well-formed run id get thumbs", () => {
  assert.equal(traceSpanIdOf({ metadata: { traceSpanId: SPAN } }), SPAN);
  assert.equal(traceSpanIdOf({ traceSpanId: SPAN }), SPAN);
  assert.equal(traceSpanIdOf({ metadata: {} }), null);
  assert.equal(traceSpanIdOf({ metadata: { traceSpanId: "not-an-id" } }), null);
  assert.equal(traceSpanIdOf({ metadata: { traceSpanId: 42 } }), null);
  assert.equal(traceSpanIdOf(null), null);
  assert.equal(isTraceSpanId("4F2A9C1E7B3D5A60"), false);
  assert.equal(isTraceSpanId(`${SPAN}${SPAN}`), true);
});

test("the body: score, trimmed comment capped at 1,000 characters, no empty comment", () => {
  assert.deepEqual(feedbackBody("c1", SPAN, 1), { conversationId: "c1", traceSpanId: SPAN, score: 1 });
  assert.deepEqual(feedbackBody("c1", SPAN, 0, "   "), { conversationId: "c1", traceSpanId: SPAN, score: 0 });
  assert.equal(feedbackBody("c1", SPAN, 0, "  too long ".repeat(200)).comment?.length, FEEDBACK_COMMENT_MAX);
});

test("the URL is the agent's feedback route", () => {
  assert.equal(feedbackUrl("https://agent.example.test/"), "https://agent.example.test/api/marketer/feedback");
});

test("sends with the session token and resolves on 204", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  await sendFeedback({ origin: "https://agent.example.test", token: "session-token-test", body: feedbackBody("c1", SPAN, 1, "great"), fetch: fake });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://agent.example.test/api/marketer/feedback");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, "Bearer session-token-test");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { conversationId: "c1", traceSpanId: SPAN, score: 1, comment: "great" });
});

test("refusals and network errors become readable errors", async () => {
  for (const status of [403, 404, 500]) {
    const fake = (async () => new Response("{}", { status })) as unknown as typeof fetch;
    await assert.rejects(sendFeedback({ origin: "https://a.test", token: "t", body: feedbackBody("c1", SPAN, 0), fetch: fake }), (e: unknown) => e instanceof FeedbackError && e.status === status && e.message === feedbackError(status));
  }
  const down = (async () => {
    throw new TypeError("network");
  }) as unknown as typeof fetch;
  await assert.rejects(sendFeedback({ origin: "https://a.test", token: "t", body: feedbackBody("c1", SPAN, 0), fetch: down }), FeedbackError);
  assert.match(feedbackError(403), /role/);
});
