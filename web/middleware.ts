import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher([
  "/onboarding(.*)",
  "/dashboard(.*)",
  "/queue(.*)",
  "/articles(.*)",
  "/connect(.*)",
  "/settings(.*)",
  "/niches(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  // Auth middleware runs ONLY where auth exists: the app, the auth pages,
  // and the JWT-attaching proxy. Marketing pages never touch Clerk — no
  // handshake redirects, no auth latency, no clerk-js in their bundles.
  matcher: [
    "/(onboarding|dashboard|queue|articles|connect|settings|niches)(.*)",
    "/(sign-in|sign-up)(.*)",
    "/api/proxy(.*)",
  ],
};
