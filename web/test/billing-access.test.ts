import assert from "node:assert/strict";
import { test } from "node:test";
import { PLAN_COPY, redeemErrorMessage } from "../lib/billing-access.ts";

test("every redeem failure code has its own plain sentence", () => {
  const codes = ["code_unknown", "code_expired", "code_used_up", "code_already_redeemed", "person_only"];
  const messages = codes.map((c) => redeemErrorMessage(c, 400));
  assert.equal(new Set(messages).size, codes.length);
  for (const m of messages) assert.match(m, /^[A-Z].*\.$/);
  assert.match(redeemErrorMessage(null, 429), /Wait a minute/);
  assert.match(redeemErrorMessage(null, 401), /Sign in again/);
  // Never echoes what the server sent.
  assert.doesNotMatch(redeemErrorMessage("<script>", 500), /script/);
});

test("the plan screen offers 2 to 4 packs with exactly one recommended", () => {
  const plans = Object.values(PLAN_COPY);
  assert.ok(plans.length >= 2 && plans.length <= 4);
  assert.equal(plans.filter((p) => p.recommended).length, 1);
  for (const p of plans) assert.ok(p.points.length <= 3, `${p.title}: three plain points at most`);
});

test("the verification email carries the code above the link, and only a numeric code", async () => {
  const { renderEmail } = await import("../lib/auth/email.ts");
  const m = { to: "a@b.co", subject: "Verify", link: "https://x.test/v?t=1", action: "Verify your email", lines: ["Enter this code."] };
  const withCode = renderEmail({ ...m, code: "042517" });
  assert.match(withCode.text, /Your code: 042517/);
  assert.ok(withCode.text.indexOf("042517") < withCode.text.indexOf("https://x.test"));
  assert.match(withCode.html, /042517/);
  const injected = renderEmail({ ...m, code: "<b>1</b>" });
  assert.doesNotMatch(injected.html, /<b>1<\/b>/);
  assert.doesNotMatch(renderEmail(m).text, /Your code/);
});
