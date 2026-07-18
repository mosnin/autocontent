import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const ONBOARDED_COOKIE = "mk_onboarded";

const isProtected = createRouteMatcher([
  "/home(.*)",
  "/onboarding(.*)",
  "/dashboard(.*)",
  "/queue(.*)",
  "/calendar(.*)",
  "/studio(.*)",
  "/library(.*)",
  "/articles(.*)",
  "/press(.*)",
  "/ads(.*)",
  "/connect(.*)",
  "/settings(.*)",
  "/niches(.*)",
  "/admin(.*)",
]);

// Routes a not-yet-onboarded user may still reach: onboarding itself (plus
// /connect, which onboarding links out to). Everything else app-side routes
// through the gate, so onboarding fires no matter how the signup arrived
// (sign-up page, OAuth via sign-in, a deep link…).
const isOnboardingExempt = createRouteMatcher([
  "/onboarding(.*)",
  "/connect(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isProtected(req)) return;
  await auth.protect();

  if (isOnboardingExempt(req)) return;
  const { userId } = await auth();
  if (userId && !req.cookies.get(ONBOARDED_COOKIE)) {
    // Cookie is a fast per-device mirror of Clerk metadata. /onboarding
    // self-heals it for already-onboarded users on a new device, so this
    // redirect is invisible to them.
    return NextResponse.redirect(new URL("/onboarding", req.url));
  }
});

export const config = {
  // Auth middleware runs ONLY where auth exists: the app, the auth pages,
  // and the JWT-attaching proxy. Marketing pages never touch Clerk — no
  // handshake redirects, no auth latency, no clerk-js in their bundles.
  matcher: [
    "/(home|onboarding|dashboard|queue|calendar|studio|library|articles|press|ads|connect|settings|niches|admin)(.*)",
    "/(sign-in|sign-up)(.*)",
    "/api/proxy(.*)",
  ],
};
