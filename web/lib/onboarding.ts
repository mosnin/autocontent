"use server";

// Onboarding state, done properly: the durable source of truth is Clerk
// publicMetadata.onboardingComplete; a long-lived httpOnly cookie mirrors it
// so the middleware gate can check without an API call per request. New
// device → cookie missing → gate sends the user to /onboarding, which
// self-heals the cookie from metadata and bounces straight back out.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, clerkClient } from "@clerk/nextjs/server";

// Mirrored in middleware.ts — a "use server" module may only export async
// functions, so the name lives in both places by design.
const ONBOARDED_COOKIE = "mk_onboarded";

async function markOnboarded(): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  // Durable flag first; the cookie is just a fast mirror.
  try {
    const client = await clerkClient();
    await client.users.updateUserMetadata(userId, {
      publicMetadata: { onboardingComplete: true },
    });
  } catch {
    // Metadata write is best-effort — the cookie still unblocks this device,
    // and the next completion re-attempts the durable write.
  }
  const jar = await cookies();
  jar.set(ONBOARDED_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}

/** Called when the user finishes (or explicitly skips) onboarding. */
export async function completeOnboardingAction(
  redirectTo: string = "/home",
): Promise<void> {
  await markOnboarded();
  redirect(redirectTo);
}

/** Creating a channel IS completing onboarding — actions.ts calls this before
 *  its redirect so the gate never re-fires after a successful setup. */
export async function markOnboardedInline(): Promise<void> {
  await markOnboarded();
}
