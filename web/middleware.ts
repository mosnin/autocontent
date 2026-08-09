import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Every first-level segment under `app/(app)/`. This list is the auth
// boundary for the whole product, and it is checked against the actual
// directory listing by `tests/test_web_route_protection.py` — a new page
// added under (app)/ without a matching entry here fails CI rather than
// shipping unprotected. It has silently drifted before (library,
// templates, and campaigns were all live and unauthenticated), which is
// why the invariant is enforced by a test instead of by remembering.
const APP_SEGMENTS = [
  "ad-creatives",
  "admin",
  "ads",
  "articles",
  "calendar",
  "campaigns",
  "connect",
  "dashboard",
  "dramas",
  "home",
  "library",
  "motion",
  "niches",
  "onboarding",
  "queue",
  "scheduled",
  "seo-audit",
  "settings",
  "templates",
  "ugc",
] as const;

const APP_GROUP = `/(${APP_SEGMENTS.join("|")})(.*)`;

const isProtected = createRouteMatcher([APP_GROUP]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  // Auth middleware runs ONLY where auth exists: the app, the auth pages,
  // and the JWT-attaching proxy. Marketing pages never touch Clerk — no
  // handshake redirects, no auth latency, no clerk-js in their bundles.
  // That exemption is why this stays an allow-list rather than being
  // inverted to "everything except marketing".
  matcher: [
    APP_GROUP,
    "/(sign-in|sign-up)(.*)",
    "/api/proxy(.*)",
    // Media manager: GET stays public, POST/DELETE check auth() in-route —
    // clerkMiddleware just needs to run here so auth() is available.
    "/api/media",
  ],
};
