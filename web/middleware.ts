import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Every app route. Keep in sync with the matcher below.
const APP = "home|activity|inbox|sessions|analytics|plan|library|content|seo|paid|distribution|playbooks|brand|integrations|settings|onboarding|admin";

const isProtected = createRouteMatcher([new RegExp(`^/(${APP})(/.*)?$`), "/api/agent(.*)", "/api/onboarding(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  // Auth middleware runs ONLY where auth exists: the app, the auth pages,
  // the JWT-attaching proxy and the agent session route. Marketing pages
  // never touch Clerk (no handshake redirects, no clerk-js in their bundles).
  // Legacy routes (/dashboard, /ads, …) redirect in next.config.js first.
  matcher: [
    "/(home|activity|inbox|sessions|analytics|plan|library|content|seo|paid|distribution|playbooks|brand|integrations|settings|onboarding|admin)(.*)",
    "/(sign-in|sign-up)(.*)",
    "/api/proxy(.*)",
    "/api/agent(.*)",
    // Onboarding decisions (server-side model key; signed-in users only).
    "/api/onboarding(.*)",
    // Media manager: GET stays public, POST/DELETE check auth() in-route.
    "/api/media",
  ],
};
