"use client";

import type { ReactNode } from "react";
import { authClient } from "@/lib/auth/client";

// Signed-in / signed-out switches for the marketing site. They ask Better
// Auth's get-session once (shared by every switch on the page) and show the
// signed-out variant until it answers, so a signed-out visitor never sees a
// flash of "Open app".

export function SignedIn({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  return !isPending && data ? <>{children}</> : null;
}

export function SignedOut({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  return isPending || !data ? <>{children}</> : null;
}
