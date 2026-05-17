import Link from "next/link";
import { KeyRound, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { SpendCapForm } from "./SpendCapForm";

export const dynamic = "force-dynamic";

// Index page for the settings sub-tree. Contains a Spend Caps section
// plus nav cards for Connect and Tokens.
export default async function SettingsPage() {
  // Best-effort: if the user fetch fails we still render the page.
  let user: User | null = null;
  try {
    user = await api<User>("/api/v1/users/me");
  } catch {
    // ignore — form renders with empty default
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connections, authentication, and per-account config.
        </p>
      </div>

      {/* Spend caps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Spend caps</CardTitle>
          <CardDescription>
            Set a global daily limit across all niches. Leave blank for no
            global cap (each niche still has its own per-niche cap).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SpendCapForm initialCap={user?.global_daily_cap_usd ?? null} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <Link2 className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">Socials</CardTitle>
            <CardDescription>
              Link Ayrshare so scheduled posts actually ship.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link href="/connect">Open</Link>
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <KeyRound className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">
              Personal access tokens
            </CardTitle>
            <CardDescription>
              For the CLI, MCP server, and external agents.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link href="/settings/tokens">Manage</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
