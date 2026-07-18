# e2e: web smoke suite

One script, `smoke.mjs`, that proves the built web app actually serves.
It builds the Next.js app once, starts it on a free local port with
placeholder Clerk env, hits every marketing page and every gated app
route over a real Chromium, and screenshots each into `e2e/shots/`
(gitignored).

## What it checks

**Marketing pages** (`/`, `/pricing`, `/features`, `/use-cases`,
`/company`, `/resources`, `/legal/terms`): each must return `200`, render
the expected `h1`, and show no hydration-error signal (a minified React
hydration error code, a hydration-mismatch console message, or the
Next.js client-exception page).

**App routes** (`/dashboard`, `/press`, `/studio`, `/library`, `/ads`):
each must never respond `5xx`. Two different things count as a pass,
because `web/middleware.ts` only protects some of these paths:

- the route serves the page (not in `middleware.ts`'s matcher, so
  `clerkMiddleware()` never runs on it: today that is `/studio` and
  `/library`); the suite also does a full render for these and checks for
  hydration errors, same as the marketing pages.
- the route is blocked by the Clerk auth gate (a redirect, or a
  `signed-out` response the gate produced): today that is `/dashboard`,
  `/press`, and `/ads`.

Both are legitimate outcomes for a logged-out request; only a `5xx`
fails the check.

### Why app routes are checked over plain HTTP, not a full browser load

This environment has no real Clerk application; the publishable key used
here (`pk_test_Y2xlcmsuY2xlcmsuZGV2JA`, the same one
`.github/workflows/ci.yml` uses for the compile-only build gate) decodes
to a placeholder Frontend API domain that does not exist. A route
`clerkMiddleware()` blocks tries a cross-origin "dev browser" handshake
against that domain to determine whether the visitor might still be
signed in; a real browser will hang or reset trying to reach a domain
that is not there, which is an artifact of testing without a real Clerk
instance, not a reflection of the app's behavior. A plain HTTP request
(Playwright's `request` context, no client JS) gets the same top-level
response `clerkMiddleware()` produced without chasing that handshake, so
the suite uses that to read the status reliably, and only falls back to
a full browser render (for the screenshot and hydration check) on routes
that actually serve a page.

With a real Clerk instance configured, gated routes would additionally
be expected to redirect cleanly to `/sign-in`; this suite still passes in
that case, since a `3xx` counts the same as the `signed-out` block does
here.

## Running it

Requires the environment's global Playwright install and the pre-fetched
Chromium binary (already present in this sandbox); nothing is added to
`web/package.json` and no browser is downloaded.

```bash
NODE_PATH=/opt/node22/lib/node_modules \
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  node e2e/smoke.mjs
```

Flags:

- `--skip-build`: reuse the existing `web/.next` build instead of running
  `next build --no-lint` again. Useful when iterating on the suite
  itself; do a full run before trusting the result.
- `--keep-alive`: leave the `next start` server running after the checks
  finish (useful for poking around manually at the printed URL). Without
  it the server is killed on exit, including on failure.

The script starts `next start` on a free local port it picks itself
(`net.createServer().listen(0, ...)`), so it never collides with a port
already in use.

Exit code is `0` only if every check passed. A summary table prints to
stdout either way; screenshots land in `e2e/shots/` regardless of
pass/fail, so a failing run still leaves visual evidence to look at.

## Notes

- Only one team builds the web app in this repo at a time (see the repo
  root `CLAUDE.md` / task ownership); `smoke.mjs` does the build itself so
  no separate build step is needed first.
- The suite does not attempt to sign in. Testing the authenticated app
  surface (dashboard content, studio render, ads governance UI, and so
  on) needs a real Clerk test user and is out of scope for a smoke check.
