# Web app security audit (`web/`)

Scope: the Next.js 15 app in `web/`: route handlers, server actions, middleware, response headers, cookies, client exposure, redirects, XSS sinks and dependencies. The FastAPI backend and the agent Worker are out of scope except where the web app hands them a credential.

Each finding has a severity, a status and the file that holds the fix. "Open" findings say why they were left and who owns them.

## Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | Any signed-in user could replace or delete public site images, and upload SVG that runs script on the app's origin | Fixed |
| 2 | High | `/api/proxy` forwarded any backend path, unauthenticated callers included, with no CSRF check or body cap, and passed `Set-Cookie` and CORS headers back | Fixed |
| 3 | High | `/preview/**` (the app shell with no sign-in) was reachable in production | Fixed |
| 4 | High | Dependency advisories: 1 critical (Next.js), 7 high | 6 of 8 fixed by patch bumps in the lockfile; 2 open |
| 5 | Medium | No security headers at all (no CSP, HSTS, `nosniff`, frame protection, referrer or permissions policy) | Fixed; the full CSP is report-only for now |
| 6 | Medium | `/api/onboarding/decisions` had no rate limit, parsed an unbounded body and returned the model provider's error text | Fixed |
| 7 | Medium | Server actions returned raw backend error bodies to the browser | Fixed |
| 8 | Medium | Agent session tokens lived for an hour and were minted with no rate limit | Fixed (15 minutes); the audience claim is open, see below |
| 9 | Medium | Server actions put form-supplied ids straight into backend paths, and redirected to URLs from backend responses without a scheme check | Fixed |
| 10 | Low | `Markdown` accepted protocol-relative links (`[x](//other.site)`) | Fixed |
| 11 | Low | The article renderer accepts any link and image scheme | Open: component owned by another stream |
| 12 | Low | Admin media picker still offers SVG | Open: page owned by another stream |
| 13 | Low | Cookies set from the browser have no `Secure` flag; the sidebar cookie has no `SameSite` | Open: components owned by another stream |
| 14 | Low | The in-memory rate limiter is per server instance | Open: accepted, documented |
| 15 | Info | `robots.txt` does not list `/preview` | Open: covered by `X-Robots-Tag` |

## Findings

### 1. Public media could be written by any signed-in user (High, fixed)

`POST /api/media` and `DELETE /api/media` only checked that a Clerk session existed. The images they write appear on the public marketing site, so any account could deface it. The upload also accepted `image/svg+xml`, and `/api/media/file/[id]` served it from the app's origin: an SVG opened directly runs its script there, with the visitor's session.

Fix, in `web/app/api/media/route.ts` and `web/app/api/media/file/[id]/route.ts`:

- Writes need an admin. The route asks the backend the same question the `/admin` layout asks (`/api/v1/admin/overview`); any failure is a refusal, including the backend being down.
- Writes must be same-origin, are rate limited per user, and the body is read with a byte cap before it is parsed.
- SVG is no longer accepted, and the bytes must match the declared type (PNG, JPEG, GIF or WebP signature).
- The file route serves raster types only, with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. An SVG stored before this change is now a 404.

Left for the page's owner: `web/app/(app)/admin/media/MediaClient.tsx` still lists `image/svg+xml` in the file input's `accept`. Picking an SVG now gets a 415.

### 2. `/api/proxy` was broader than it needed to be (High, fixed)

Before:

- Any path was forwarded (`/docs`, `/openapi.json`, anything the backend serves), and dot segments were not rejected.
- Signed-out callers were forwarded too, without a token.
- Mutations had no origin check. Clerk's session cookie is `SameSite=Lax`, which stops a cross-site form post, but not a request from another site on the same registrable domain.
- The request body was buffered with no limit.
- The response passed through `Set-Cookie`, `Access-Control-*`, `Server` and the rest. A backend response could set a cookie on the app's origin.
- `Content-Encoding` was passed through even though `fetch` had already decoded the body.
- A fetch failure became an unhandled 500.

The host was never client-controlled: it came from `NEXT_PUBLIC_API_BASE_URL`. With the variable unset the route threw.

Now (policy in `web/lib/security/proxy-policy.ts`, route in `web/app/api/proxy/[...path]/route.ts`):

- **Destination.** The origin is the configured backend only. No header, query or path segment can change it. Only `/api/v1/**` is forwarded. Empty, `.`, `..`, slash, backslash and control characters in a segment are refused; segments are re-encoded; the final URL is parsed again and checked against the origin and the prefix. In production a non-local backend must be `https`. A missing or malformed base is a 503.
- **Auth.** Signed-in callers only (401 otherwise). The Clerk token is read server-side and attached here.
- **Request headers.** An allowlist: `content-type`, `accept`, `range`, `if-range`, `if-none-match`, `if-modified-since`. Cookies, `Host`, `X-Forwarded-*` and any client `Authorization` never reach the backend.
- **Response headers.** Hop-by-hop headers, `Set-Cookie`, `Access-Control-*`, HSTS, CSP, `Server`, `Via` and `X-Powered-By` are dropped. `nosniff` is added. An HTML, XHTML, XML or SVG response gets `default-src 'none'; sandbox`, so it cannot run as a page on the app's origin.
- **Body.** Capped at 1 MB (413 past it). Every caller sends JSON; nothing uploads through the proxy.
- **CSRF.** Non-GET requests must carry an `Origin` that matches the request host, or `Sec-Fetch-Site: same-origin`. A request with neither is refused.
- **Errors.** An unreachable backend is a 502 with a fixed message. The backend host is never echoed.

Redirects are still passed back unfollowed, so the library's 307 to presigned storage streams directly, and the token is never sent to the redirect target.

### 3. `/preview/**` was public in production (High, fixed)

The preview renders the app shell with fixture data and no sign-in. It holds no real data, but it exposes the whole signed-in UI and its routes, and it was indexable.

Now it is a 404 in production unless `ENABLE_PREVIEW=1` is set at runtime. In development it is on (set `ENABLE_PREVIEW=0` to turn it off), so the screenshot tooling works unchanged. Two layers apply the same rule (`previewEnabled` in `web/lib/security/urls.ts`): the middleware, and `web/app/preview/layout.tsx`, which holds even if the middleware matcher changes. Preview responses carry `X-Robots-Tag: noindex, nofollow` and never go through Clerk.

### 4. Dependencies (High)

`npm audit --omit=dev` in `web/` reported 8 advisories (1 critical, 7 high):

| Package | Severity | Installed | Fix | Status |
|---|---|---|---|---|
| `next` | Critical (DoS in server actions, SSRF on custom servers, cache confusion, others) | 15.5.18 | 15.5.29 (patch) | Fixed in the lockfile |
| `@clerk/shared` | High | 3.47.5 | 3.48.1 (minor) | Fixed in the lockfile |
| `js-cookie` (via Clerk) | High | 3.0.5 | 3.0.7 | Fixed in the lockfile |
| `nanoid` (via postcss) | High | 3.3.12 | 3.3.20 | Fixed in the lockfile |
| `sharp` (via next) | High | 0.34.5 | 0.35.5 | Fixed in the lockfile |
| `source-map-js` | High | 1.2.1 | 1.2.2 | Fixed in the lockfile |
| `postcss` | High | 8.4.31, pinned inside `next`; 8.5.14 under Tailwind | above 8.5.22 | Open. Next pins its own copy, so only a Next release moves it. It runs at build time on our own CSS, never on user input. |
| `zod` | High (memory exhaustion on oversized collections) | 3.25.76 | 4.6.7 (major) | Open. A major bump; needs its own change. The web app validates only small, bounded forms with it, and bodies are now size-capped before parsing. |

Only `web/package-lock.json` changed; `package.json` ranges already allowed every bump. The patched tree was installed in a scratch directory and passed `tsc`, `npm test` and a production build there. **The shared `web/node_modules` was not reinstalled**, because other work was running against it: run `npm ci` in `web/` to pick the new versions up locally. CI installs from the lockfile.

`pnpm audit --prod` in `agent/` reported 1 high: `picomatch` ReDoS (GHSA-fc5q-39xc-vjpf) through `agents > @rolldown/plugin-babel > picomatch`. No patched version is published ("<0.0.0"). It is a build-time glob matcher fed by our own config, not request input. Open until upstream ships a fix.

Both audits now run in CI as report-only steps.

### 5. Security headers (Medium, fixed; CSP report-only)

There were none. `web/next.config.js` now sends, on every response:

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (production builds only) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation, usb, serial, bluetooth, payment and browsing-topics all off |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` (OAuth popups keep working) |
| `Content-Security-Policy` | enforced baseline: `frame-ancestors 'none'; base-uri 'self'; object-src 'none'` |

`X-Powered-By` is off. HSTS has no `preload`: that is a one-way registration and a decision for whoever owns the domain.

#### Content-Security-Policy

Two policies, because the app has two kinds of page.

**Clerk-routed pages** (the app, onboarding, sign-in, sign-up) are rendered per request, so they get a nonce-based policy from the middleware, built by Clerk's own `contentSecurityPolicy` option in strict mode with our directives merged in (`web/lib/security/csp.ts`):

```
default-src 'self';
script-src 'self' 'nonce-…' 'strict-dynamic' 'unsafe-inline' <stripe, maps hosts from Clerk's defaults>;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https: https://img.clerk.com;
font-src 'self' data:;
media-src 'self' blob: https:;
connect-src 'self' <Clerk frontend API host> <Clerk telemetry> <agent origin, https and wss> <CSP_CONNECT_SRC>;
frame-src 'self' https://challenges.cloudflare.com <stripe>;
worker-src 'self' blob:; form-action 'self';
frame-ancestors 'none'; base-uri 'self'; object-src 'none'
```

With a nonce present, browsers ignore `'unsafe-inline'` in `script-src`; it is there only as a fallback for browsers without nonce support. Next puts the nonce on its own scripts (checked: every `<script>` on `/sign-in` carries it).

**Static pages** (marketing, legal, the fixture preview) are prerendered. Their inline bootstrap scripts cannot carry a per-request nonce, so `script-src` is `'self' 'unsafe-inline'`. These pages render no user content. The alternative, running the middleware on every page to mint nonces, would make the whole marketing site dynamic and put Clerk in front of it, which the app deliberately avoids. Hashes are not practical: Next's inline payload changes per page and per build.

Trade-offs taken:

- `style-src 'unsafe-inline'`: React inline styles, Clerk's components and the chart library all set styles inline. Style injection is far weaker than script injection, and removing it would need a nonce on every style.
- `img-src https:` and `media-src https:`: media comes from presigned object-storage URLs and social CDNs whose hosts vary. Images and video cannot run script.
- `connect-src` is tight: same origin, Clerk, the agent origin, and anything listed in `CSP_CONNECT_SRC` (for example a Pusher cluster, if live telemetry is switched to it).
- No `'unsafe-eval'` in production. Development builds allow it, because Next's dev runtime needs it.

**Page-transition shader** (`web/vendor/distortion-waves`, wrapped by `web/design-system/components/wave.tsx`). It pictures the DOM by serialising it into an SVG `<foreignObject>` loaded as an image, with stylesheets, fonts and images inlined as data URLs. Both policies therefore allow `img-src 'self' data: blob:`, `font-src 'self' data:` and same-origin `connect-src 'self'` fetches of the page's own CSS and images. It uses no workers, no eval and no third-party calls, so nothing else was opened for it. `web/test/security.test.ts` pins these directives. Checked in a browser against an enforce-mode build, on `/`, `/preview/app/home` and `/preview/onboarding`: an SVG `<foreignObject>` image loads from a `data:` URL and from a `blob:` URL, a `data:` font loads, the page's own stylesheet can be fetched, eval is blocked and a third-party fetch is blocked. The component's own demo page, `/preview/wave`, was then loaded in a production build with the policy in report-only mode and its buttons clicked to run transitions: no policy reports and no page errors.

**Mode.** The full policy is sent as `Content-Security-Policy-Report-Only` until `CSP_MODE=enforce` is set, **at build time and at runtime** (`next.config.js` headers are fixed at build; the middleware reads the variable per request). The reason: sign-in could not be exercised end to end here. This container has only a placeholder Clerk key, and Clerk answers `/sign-in` with a 422 before its widget loads. The policy comes from Clerk's own generator, so the risk is low, but it is unproven against a live instance, the bot challenge and any social login in use.

What was verified in enforce mode: the build compiles; each route sends exactly one CSP header; the marketing pages and the preview app shell load with no page errors and no violations other than the one below.

Known report: one `script-src` eval report per page from `zod`'s feature probe (`try { new Function("") } catch {}`), which arrives through a client dependency. Under enforcement the probe is blocked, caught, and the library takes its non-eval path. It needs no allowance.

To turn enforcement on: deploy with report-only, sign in and out with each method in use, watch the browser console for "report-only" messages, add any missing host to `CSP_CONNECT_SRC` or `csp.ts`, then set `CSP_MODE=enforce`. No report endpoint is configured; add `reportTo` in `middleware.ts` if you want reports collected.

### 6. `/api/onboarding/decisions` (Medium, fixed)

Auth was already right (signed-in users only, in the middleware and in the route), the key never leaves the server, and the framework's handler bounds the state and the questions. Three gaps, fixed in `web/app/api/onboarding/decisions/route.ts`:

- **Rate limit.** Each call spends model money. Now 20 per user per minute per instance, 429 with `Retry-After`. The onboarding flow treats any non-200 as "keep the rule", so a limited user loses nothing but the model's pre-selection.
- **Body size.** `req.json()` buffered anything. Now capped at 128 kB before parsing (413).
- **Error text.** A provider failure returned the provider's message. Now a fixed `decision failed`.

It also refuses cross-origin posts. The log line was already a hash of the state, never the state or the key.

### 7. Backend error bodies reached the browser (Medium, fixed)

`web/lib/api.ts` threw `"<status> <raw body>"`, and every server action returns that message in its result. A 500 from the backend could carry a stack trace or a connection string into the page.

Now the message is `"<status> <detail>"`: the backend's `detail` field for 4xx (bounded to 300 characters), a fixed sentence for 5xx, and never a non-JSON body. The status prefix is kept because pages match on it (`403`, `404`). The error pages already refuse to render `error.message`; they show only the digest.

### 8. Agent session tokens (Medium, partly fixed)

`GET /api/agent/session` mints an HMAC token the browser sends to the agent Worker.

| Check | Result |
|---|---|
| Tenant source | Correct. `sub` and `tid` are the Clerk user id from `auth()`. Nothing in the request is read. |
| Expiry | Was 1 hour. Now 15 minutes (`AGENT_SESSION_TTL_SECONDS`, clamped to 1–60 minutes). The browser already refreshes five minutes before expiry. |
| Constant-time verify | Correct where tokens are verified: the Worker's `verifySessionToken` uses a constant-time compare over the full signature. The web app verifies these tokens nowhere. `web/lib/security/agent-token.ts` has a verifier with the same compare, used by the tests. |
| Audience | **Open.** The token has no `aud`. In the agent's format, `aud` marks a *restricted* token (widget, voice) and full-user tokens are the ones without it, so adding one from the web side would get every token rejected. Binding the token to the agent needs a change in `agent/` (accept an explicit audience for host tokens). What limits misuse today: the secret is shared only with the Worker, the token carries an `env` claim, and it now expires in 15 minutes. |
| Secret | A missing or short (under 16 characters) secret now reports "not configured" instead of minting a weak token. |
| Origin | `NEXT_PUBLIC_AGENT_ORIGIN` must parse as an origin, and be `https` in production unless local. The token is only ever sent there. |
| Rate limit | 30 per user per minute. |
| Caching | `no-store`, as before. |

A shorter lifetime means the chat client is rebuilt with the new token every ten minutes instead of every fifty-five. If that interrupts long streams, raise `AGENT_SESSION_TTL_SECONDS`.

### 9. Server actions: ids and redirects (Medium, fixed)

- Ids from forms (`niche_id`, `job_id`, `article_id`, `token_id`) went into backend paths as-is, so `../users/me` reached a different endpoint. The user's own token was used, so this crossed no tenant boundary, but it let a form reach endpoints the action was not written for. Ids must now match `[A-Za-z0-9_-]{1,128}` (`idSegment` in `web/lib/security/urls.ts`).
- `connectAyrshareAction` redirected to `login_url` from the backend, and `createCheckoutAction` returned a `url` the client navigates to. Both now require an absolute `https` URL.

Next's server actions already refuse cross-origin posts. Every action calls the backend with the caller's own Clerk token, and the backend scopes by that token; none takes a tenant or user id from the form.

### 10–13. XSS sinks and cookies

- **`dangerouslySetInnerHTML`**: seven marketing pages use it for JSON-LD built from constants in the same file, and the chart component uses it for CSS built from a config object. No user content reaches any of them.
- **`Markdown`** (`web/design-system/components/markdown.tsx`) renders agent replies as React elements; no raw HTML. Links were limited to `http(s)://` or a path starting with `/`, which also matched `//other.site` and `/\other.site`. Those open another site in the same tab with no `rel`. **Fixed** in the pattern. This file belongs to the design-system stream; the change is one line plus a comment.
- **Article renderer** (`web/components/app/seo/article-body.tsx`), **open, Low**: link `href` and image `src` accept any scheme. React 19 refuses to render `javascript:` URLs, which removes the script risk, but `data:` links and arbitrary image hosts (a tracking pixel in generated content) still pass. Suggested fix for the owner: accept `https?://`, `mailto:` and single-slash paths for links, `https://` for images, and add `noopener` to `rel`.
- **Other links from data** (`postUrl` in `video-detail-view.tsx`, `targetUrl` in `article-detail-view.tsx`, `redirect_url` in `ad-accounts-view.tsx` and the onboarding flow): the same note. React blocks `javascript:`; an `https`-only check (`safeExternalUrl`) would close the rest.
- **`marketer-theme` cookie** (`web/components/shell/theme.ts`): `path=/; max-age=1 year; samesite=lax`. It is written from the browser, so it cannot be `HttpOnly`. The server only compares it with `"light"`, so a forged value does nothing. It lacks `Secure`. Low; add `; secure` when the page is on https.
- **Sidebar cookies** (`web/components/ui/sidebar.tsx`, `web/components/square/ui/sidebar.tsx`): no `SameSite`, no `Secure`. Preference only. Low.
- Clerk sets its own session cookies with its own flags. The web app sets no other cookie, and the proxy now strips `Set-Cookie` from the backend.

### Middleware and public routes

Public by design: the marketing site, `/sign-in`, `/sign-up`, `GET /api/media` and `GET /api/media/file/[id]` (public site images), `robots.txt`, `sitemap.xml`.

Signed-in only: every app route and `/onboarding` (middleware `auth.protect()`), `/api/agent/**`, `/api/onboarding/**` (middleware and in-route), `/api/proxy/**` (in-route 401), writes to `/api/media` (in-route, admin).

`/admin` is guarded by its layout, which asks the backend; the backend also enforces admin on every admin endpoint.

`/preview/**`: see finding 3.

### Open redirects

None found. Sign-in and sign-up use fixed `fallbackRedirectUrl`s. Clerk validates its own `redirect_url` parameter against the instance's allowed origins; keep that list tight in the Clerk dashboard. No route or action reads a return URL from the query. `safeReturnPath` exists in `web/lib/security/urls.ts` for when one does. All `next.config.js` redirects go to fixed same-site paths.

### Client exposure

`NEXT_PUBLIC_*` variables in use: `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_AGENT_ORIGIN`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. All are URLs or a publishable key. Server-only: `CLERK_SECRET_KEY`, `SESSION_SIGNING_SECRET`, `OPENROUTER_API_KEY`, `DECISION_MODEL`.

The built client output (`.next/static`) was searched for the secret names, key prefixes, the decision model slug and the mint function. The only hits are two variable *names* in text (a setup hint in the chat's offline state, and Clerk's own env lookup). No values. `lib/agent/session.ts` and the server fetchers import `server-only`.

### Smaller notes

- **Rate limiter (14).** `web/lib/security/rate-limit.ts` is in memory and per instance. On a multi-instance or serverless deploy the effective limit is the per-instance limit times the instance count. It bounds abuse from one session; it is not a quota. A shared store would fix it and is a deployment decision.
- **Uploaded media on disk.** `web/data/media/manifest.json` is not git-ignored (the images are, by extension). Add `web/data/` to `.gitignore`.
- **`robots.txt` (15)** does not list `/preview`. The `X-Robots-Tag` header covers it; adding the path is a one-word change in `web/app/robots.ts`.

## New environment variables

| Variable | Default | Effect |
|---|---|---|
| `ENABLE_PREVIEW` | off in production, on in development | `1` serves `/preview/**` in production; `0` hides it in development |
| `CSP_MODE` | report-only | `enforce` enforces the full policy; set at build and at runtime |
| `CSP_CONNECT_SRC` | empty | extra `connect-src` origins (`https://…` or `wss://…`), space or comma separated |
| `AGENT_SESSION_TTL_SECONDS` | 900 | agent token lifetime, clamped to 60–3600 |

## Tests

`cd web && npm test` runs `web/test/security.test.ts` on Node's built-in runner (26 tests, no new dependency): the proxy's path allowlist, traversal and host-injection cases, request and response header policy, the same-origin check, body caps, token minting and verification (expired, forged tenant, wrong secret, truncated signature), TTL clamping, the rate limiter, id and URL validation, error shaping, the preview flag and the CSP directives.

The route handlers themselves have no automated tests: the repo has no harness for Next route handlers with Clerk. They were exercised by hand against a production build (see below).

## What was verified, and what was not

Verified against a production build of this tree, run locally with a placeholder Clerk key:

- every response carries the headers in finding 5; Clerk-routed pages carry a per-request nonce;
- `/preview/app/home` and `/preview/onboarding` are 404 by default and 200 with `ENABLE_PREVIEW=1`; in development they are 200;
- `/api/proxy`: 401 signed out, 404 outside `/api/v1`, 404 on encoded traversal, 403 on a cross-origin post and on a post with no origin;
- `/api/media`: 401 for a signed-out write, 403 cross-origin, public read still 200;
- `/api/agent/session` and `/api/onboarding/decisions` refuse signed-out callers.

Not verified, because it needs a real Clerk instance or a running backend:

- any signed-in path: the proxy forwarding with a token, the admin check on media writes, the rate limits returning 429, token minting through the route;
- the CSP on the Clerk sign-in widget and on signed-in app pages (the reason it is report-only);
- the agent Worker accepting the 15-minute token (the format and claims are unchanged, only `exp` moved).
