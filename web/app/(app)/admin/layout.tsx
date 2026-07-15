import { Lock, ShieldCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { fetchAdminOverview, isForbidden } from "@/lib/admin-server";

export const dynamic = "force-dynamic";

/**
 * Thin server-side guard for the whole /admin surface. We probe the
 * admin overview: a 403 means the caller is not an admin, so we render a
 * clean "not authorized" state and nothing else — no admin chrome, no hint
 * of what lives behind the wall. On success we wrap the page in a subtle
 * "Admin" band so the surface reads as visually distinct from the normal
 * dashboard while sharing the same shell.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let authorized = true;
  try {
    await fetchAdminOverview();
  } catch (err) {
    if (isForbidden(err)) {
      authorized = false;
    } else {
      // Anything else (network, 5xx) surfaces to the nearest error
      // boundary rather than masquerading as an auth failure.
      throw err;
    }
  }

  if (!authorized) {
    return <NotAuthorized />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
          <ShieldCheck className="size-3.5" aria-hidden />
          Admin
        </span>
        <span className="text-xs text-muted-foreground">
          Platform administration · every action here is audited
        </span>
      </div>
      {children}
    </div>
  );
}

function NotAuthorized() {
  // Rendered inside the app shell's <main>, so this is a plain section —
  // a nested <main> would be invalid and confuse assistive tech.
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="rounded-full bg-muted p-3">
            <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <h1 className="text-lg font-semibold">Not authorized</h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            You don&apos;t have access to this area. If you believe this is a
            mistake, contact your workspace administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
