import { SiteShell } from "@/components/site-shell";
import { CommandPalette } from "@/components/command-palette";
import { RunConfirmProvider } from "@/components/run-confirm-dialog";

// Every protected page renders Clerk's <UserButton /> in the sidebar
// so static prerender always needs a real Clerk publishable key.
// Mark the whole group dynamic to keep CI builds (which only have a
// dummy key) green.
export const dynamic = "force-dynamic";

// Protected app group. Anything under (app)/ is rendered inside the
// sidebar shell. Auth itself still happens in `web/middleware.ts`.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RunConfirmProvider>
      <SiteShell>{children}</SiteShell>
      <CommandPalette />
    </RunConfirmProvider>
  );
}
