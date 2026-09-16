import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher([
  "/home(.*)",
  "/onboarding(.*)",
  "/dashboard(.*)",
  "/queue(.*)",
  "/calendar(.*)",
  "/articles(.*)",
  "/ads(.*)",
  "/connect(.*)",
  "/settings(.*)",
  "/niches(.*)",
  "/admin(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  // Auth middleware runs ONLY where auth exists: the app, the auth pages,
  // and the JWT-attaching proxy. Marketing pages never touch Clerk — no
  // handshake redirects, no auth latency, no clerk-js in their bundles.
  matcher: [
    "/(home|onboarding|dashboard|queue|calendar|articles|ads|connect|settings|niches|admin)(.*)",
    "/(sign-in|sign-up)(.*)",
    "/api/proxy(.*)",
    // Media manager: GET stays public. POST/DELETE require an admin role
    // (checked in-route against the backend users row). clerkMiddleware
    // still has to run here so auth() can read the session.
    "/api/media",
  ],
};
